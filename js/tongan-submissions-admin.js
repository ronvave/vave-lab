/* Tonga-only review UI. Master validation and private review journal live in Apps Script. */
(function () {
'use strict';
function el(tag,text,parent){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(parent)parent.append(n);return n;}
function parse(s,f){try{return JSON.parse(s);}catch(_){return f;}}
function checked(r){if(!r||r.status!=='ok')throw new Error(r&&(r.error||r.reason||r.status)||'No server response');return r;}
function button(label,parent,fn,cls){const b=el('button',label,parent);b.type='button';if(cls)b.className=cls;b.onclick=fn;return b;}
function link(text,url,parent){try{const u=new URL(url);if(!['https:','http:','mailto:'].includes(u.protocol))return;const a=el('a',text,parent);a.href=u.href;if(u.protocol!=='mailto:'){a.target='_blank';a.rel='noopener noreferrer';}return a;}catch(_){}}
function locationText(l){return l.national?'Tonga — general / national study':[l.division,l.island,l.district,l.village].filter(Boolean).join(' · ')||'Tonga';}
function chips(parent,title,values){const group=el('div',null,parent);el('strong',title,group);const wrap=el('div',null,group);if(!values.length)el('span','—',wrap).className='meta';values.forEach(v=>el('span',v,wrap).className='tonga-location-chip');}
function countries(s){return String(s||'').split(';').map(x=>x.trim()).filter(Boolean);}
let lastDispatch=0;
async function refreshPublic(){
 const admin=window.TongaSubmissionAdmin;
 if(admin&&typeof admin.refresh==='function'){
  if(Date.now()-lastDispatch<120000)return 'Master saved. A public refresh was started in the last 2 minutes and will include this change.';
  try{const ok=await admin.refresh({silent:true});if(ok){lastDispatch=Date.now();return 'Master saved. Public refresh started; dashboards and profiles update in about 5 minutes.';}}catch(_){}
  return 'Master saved. Public profiles update after the next scheduled data refresh (about every 2 hours). To publish sooner, save a GitHub token in Data source & GitHub.';
 }
 return 'Master saved. Public profiles update after the next successful scheduled data refresh.';
}
let countRequest=null,countAt=0;
async function queueCounts(){if(!countRequest||Date.now()-countAt>30000){countAt=Date.now();countRequest=window.adminWriteback.reviewQueueCounts().then(checked).catch(e=>{countRequest=null;throw e;});}return countRequest;}
document.querySelectorAll('[data-tonga-queue]').forEach(host=>{
 const kind=host.dataset.tongaQueue,scholar=kind==='scholar';
 const tab=document.querySelector('[data-tab="'+(scholar?'scholar-submissions':'geography-submissions')+'"]');
 const badge=el('span',null,tab);badge.className='tonga-submission-badge';badge.hidden=true;badge.setAttribute('aria-live','polite');
 let badgeBusy=false,badgeGeneration=0,busy=false,loaded=false,caps={},cards=[],lastLoaded=0,dirty=false,stale=false;
 function showCount(n){badge.textContent=String(n);badge.hidden=n===0;badge.title=n+' pending submissions';badge.setAttribute('aria-label',n+' pending submissions');}
 function ready(){const state=document.getElementById('db-status');return !document.hidden&&(!state||state.textContent.trim()==='ready')&&window.adminWriteback&&window.adminWriteback.isConfigured();}
 const read=status=>scholar?window.adminWriteback.readScholarSubmissions(status):window.adminWriteback.readGeographySubmissions(status);
 async function refreshBadge(){if(busy||badgeBusy||!ready()||!window.adminWriteback.reviewQueueCounts)return;badgeBusy=true;const generation=++badgeGeneration;try{const out=await queueCounts();if(generation===badgeGeneration)showCount(out[kind]||0);}catch(_){if(/^\d+$/.test(badge.textContent)){badge.title='Last known count: '+badge.textContent+'. The latest count check failed; it will retry.';}else{badge.textContent='?';badge.hidden=false;badge.title='Pending count unavailable. Open this tab to retry.';}}finally{badgeBusy=false;}}
 setTimeout(refreshBadge,1400);setInterval(refreshBadge,30000);window.addEventListener('focus',refreshBadge);document.addEventListener('visibilitychange',refreshBadge);
 const readyState=document.getElementById('db-status');if(readyState)new MutationObserver(refreshBadge).observe(readyState,{childList:true,characterData:true,subtree:true});

 el('p',scholar?'Proposed changes are compared with the live Master. Matching submitted values are listed as already recorded. Text revisions and attachments are checked by default. Uncheck anything you do not want, then approve the checked items.':'Geography suggestions submitted from secure scholar profile links. Review each changed publication before anything is added to Research Geography.',host).className='tonga-queue-helper';
 const toolbar=el('div',null,host);toolbar.className='tonga-queue-toolbar';
 const filter=el('select',null,toolbar);filter.setAttribute('aria-label','Submission status');['Pending',scholar?'Reviewed':'Approved','Rejected','All'].forEach(s=>{const o=el('option',s,filter);o.value=s==='All'?'':s;});
 const refresh=button('Refresh queue',toolbar,()=>load());
 const bulk=el('span',null,toolbar);bulk.className='tonga-bulk-controls';bulk.hidden=true;
 button('Check all',bulk,()=>{cards.forEach(c=>{if(c.select)c.select.checked=true;});syncSelection();});
 button('Clear selection',bulk,()=>{cards.forEach(c=>{if(c.select)c.select.checked=false;});syncSelection();});
 const bulkApprove=button('Approve all checked',bulk,bulkResolve,'tonga-approve'),selectionCount=el('span','',bulk);
 function syncSelection(){const n=cards.filter(c=>c.select?.checked).length;selectionCount.textContent=n+' selected in this view';bulkApprove.disabled=busy||stale||!n||(scholar&&!caps.selectionReview);}
 host.addEventListener('change',()=>{dirty=true;syncSelection();});
 host.addEventListener('input',()=>{dirty=true;});
 host.addEventListener('click',e=>{if(e.target.closest('.tonga-selection-controls,.tonga-bulk-controls'))dirty=true;});
 function syncCount(){count.textContent=cards.length+' submissions in this view';bulk.hidden=filter.value!=='Pending'||!cards.length;if(filter.value==='Pending'){badgeGeneration++;showCount(cards.length);}syncSelection();}
 function removeCard(c){c.card.remove();cards=cards.filter(x=>x!==c);syncCount();countRequest=null;}
 function updateCard(c,row){const saved=savedState().get(c.row['Submission ID']),before=c.card.nextSibling;removeCard(c);if(!filter.value||row.Status===filter.value){render(row,saved);const fresh=cards[cards.length-1];list.insertBefore(fresh.card,before);if(busy)fresh.card.querySelectorAll('button,input,textarea,select').forEach(x=>x.disabled=true);}syncCount();}

 const count=el('span','',toolbar);count.className='tonga-queue-count';
 const status=el('p','Open this tab to load submissions.',host);status.className='tonga-queue-status';status.setAttribute('role','status');
 const freshness=el('p','Not yet refreshed from Master.',host);freshness.className='meta';freshness.setAttribute('role','status');
 const list=el('div',null,host);
 function message(text,error){status.textContent=text;status.classList.toggle('tonga-error',!!error);}
 function savedState(){const out=new Map();cards.forEach(c=>out.set(c.row['Submission ID'],{geoKeys:c.geoPicks?c.geoPicks.filter(x=>x.checked).map(x=>x.value):undefined,note:c.note?.value,selected:c.select?.checked,picks:c.picks.map(p=>[p.key,p.box.checked,p.disposition?.value,p.evidence?.value])}));return out;}
 async function load(after){if(busy)return;busy=true;refresh.disabled=true;filter.disabled=true;message('Loading…');const controls=[...list.querySelectorAll('button,input,textarea,select')],disabled=controls.map(x=>x.disabled);controls.forEach(x=>x.disabled=true);const saved=savedState();countRequest=null;try{
   if(!window.adminWriteback||!window.adminWriteback.isConfigured())throw new Error('Configure the Tonga endpoint and shared secret in Data source & GitHub first.');
   const out=checked(await read(filter.value));
   if(!caps.version){try{caps=checked(await window.adminWriteback.reviewCapabilities());}catch(_){caps={};}}
   if(filter.value==='Pending'){badgeGeneration++;showCount((out.rows||[]).length);}else refreshBadge();
   list.replaceChildren();cards=[];(out.rows||[]).forEach(row=>render(row,saved.get(row['Submission ID'])));
   syncCount();
   if(!cards.length)el('p',scholar?'No scholar-profile submissions in this view.':'No submissions in this view.',list).className='meta';
   message(after||'');loaded=true;dirty=false;stale=false;lastLoaded=Date.now();freshness.textContent='Last refreshed from Master: '+new Date(lastLoaded).toLocaleString()+'.';
 }catch(e){stale=true;freshness.textContent=lastLoaded?'Refresh failed. Displayed submissions are from '+new Date(lastLoaded).toLocaleString()+' and may have changed.':'Refresh failed. No current queue data available.';badge.textContent='?';badge.hidden=false;badge.title='Queue refresh failed; pending count is unverified.';message((after?after+' Queue display could not reload: ':'')+e.message,true);}finally{controls.forEach((x,i)=>x.disabled=disabled[i]);busy=false;refresh.disabled=false;filter.disabled=false;syncSelection();}}
 function pick(parent,label,key,enabled,selected,c){const box=el('input',null,parent);box.type='checkbox';box.setAttribute('aria-label',label);box.disabled=!enabled;box.checked=!!selected;const p={box,key};c.picks.push(p);return p;}
 function render(row,saved){
  const pending=row.Status==='Pending',card=el('article',null,list),c={row,card,picks:[]};cards.push(c);
  card.className='tonga-review tonga-review--'+String(row.Status||'').toLowerCase();
  const top=el('div',null,card);top.className='tonga-review-heading';
  if(pending){const label=el('label',null,top);c.select=el('input',null,label);c.select.type='checkbox';c.select.checked=saved?.selected||false;c.select.setAttribute('aria-label','Select '+(row['Publication Title']||row['Scholar Name']||row['Submission ID']));label.append(' Select');}
  const heading=el('div',null,top);el('h3',scholar?(row['Scholar Name']||row['Scholar ID']):(row['Publication Title']||row['Publication Key']),heading);
  el('div',[!scholar&&row['Scholar Name'],row['Scholar ID'],!scholar&&row.Year,row['Submission ID'],row['Submitted At']].filter(Boolean).join(' · '),heading).className='meta';
  el('span',row.Status,top).className='tonga-status-pill';
  const identity=el('p',null,card);identity.className='tonga-submitter';identity.append('Submitted by: '+(row['Submitter Name']||'Unknown')+(row.Relationship?' ('+row.Relationship+')':'')+' · ');link(row['Submitter Email'],'mailto:'+row['Submitter Email'],identity);if(row['Profile URL']){identity.append(' · ');link('Submitted scholar profile',row['Profile URL'],identity);}
  if(scholar)renderScholar(c,pending);else{
    const invalid=[...countries(row['Proposed Pacific Countries']),...countries(row['Proposed Other Countries'])].filter(x=>!window.TongaCountries?.resolve(x));
    if(invalid.length)row.countryValidationError='Invalid country or area: '+invalid.join('; ');
    const grid=el('div',null,card);grid.className='tonga-geography-grid';
    chips(grid,'Current Tonga locations',(row.currentTongaLocations||[]).map(locationText));
    if(!Array.isArray(row.currentTongaLocations))el('p',row.currentGeographyError||'Current locations unavailable until the Tonga backend is updated. No locations have been inferred.',grid).className='tonga-error';
    chips(grid,'Proposed Tonga locations',parse(row['Proposed Tonga Locations JSON'],[]).map(locationText));chips(grid,'Proposed Pacific countries',countries(row['Proposed Pacific Countries']));chips(grid,'Proposed other countries',countries(row['Proposed Other Countries']));
    if(row.countryValidationError)el('p',row.countryValidationError+' Reject this suggestion or request a corrected submission.',card).className='tonga-error';
    if(pending&&caps.geographySelection&&!row.countryValidationError){
     const opts=[];parse(row['Proposed Tonga Locations JSON'],[]).forEach((l,i)=>opts.push(['tonga:'+i,'Tonga: '+locationText(l)]));
     const seenC=new Set();[...countries(row['Proposed Pacific Countries']),...countries(row['Proposed Other Countries'])].forEach(x=>{const r=window.TongaCountries?.resolve(x);const name=r?r.name:x;if(name==='Tonga'||seenC.has(name))return;seenC.add(name);opts.push(['country:'+name,name]);});
     if(opts.length){const box=el('fieldset',null,card);box.className='tonga-geo-select';el('legend','Choose which proposed locations to add',box);const savedKeys=saved?.geoKeys;c.geoPicks=opts.map(([key,text])=>{const l=el('label',null,box),cb=el('input',null,l);cb.type='checkbox';cb.value=key;cb.checked=savedKeys?savedKeys.includes(key):true;l.append(' '+text);return cb;});el('p','Unchecked locations are not added. Rows already in Research Geography are never duplicated.',box).className='meta';}
    }
  }
  if(!pending){el('p',[row.Resolution,row['Review Notes'],row['Reviewed By'],row['Reviewed At']].filter(Boolean).join(' · '),card);return;}
  const label=el('label','Optional review note',card);label.className='tonga-note-label';c.note=el('textarea',null,label);c.note.value=saved?.note||row.reviewPlan?.note||'';c.note.setAttribute('aria-label','Review note for '+row['Submission ID']);
  const actions=el('div',null,card);actions.className='tonga-review-actions';
  if(scholar){
    const ban=button('Ban submitter',actions,()=>banSubmitter(c),'tonga-ban');ban.disabled=!caps.banSubmitter;if(ban.disabled)ban.title=caps.role==='admin'?'Only the Owner can ban submitters.':'Requires verified Tonga review backend v2.';
   const approve=button(row.reviewPlan?'Resume checked review':'Approve all checked',actions,()=>approveScholar(c),'tonga-approve');approve.disabled=!caps.selectionReview;
   if(row.reviewPlan)el('p','Completed items are recorded. Unchecked items remain pending and can be selected later.',card).className='meta';
    if(!caps.selectionReview)el('p','Scholar approval requires the complete Tonga backend v4 deployment. This prevents the older backend from rejecting unchecked fields.',card).className='tonga-error';
  }else {const approve=button('Approve',actions,()=>resolveOne(c,'approve'),'tonga-approve');approve.disabled=!!row.countryValidationError;}
  button(scholar?'Reject all':'Reject',actions,()=>resolveOne(c,'reject'),'tonga-reject');
  if(saved)saved.picks.forEach(([key,value,disposition,evidence])=>{const p=c.picks.find(x=>x.key===key);if(p&&!p.box.disabled)p.box.checked=value;if(p?.disposition)p.disposition.value=disposition||'pending';if(p?.evidence)p.evidence.value=evidence||'';});
 }
 function renderScholar(c,pending){
  const {row,card}=c,plan=row.reviewPlan,changes=row.proposedChanges||[];
  if(pending){const controls=el('div',null,card);controls.className='tonga-selection-controls';button('Check all',controls,()=>c.picks.forEach(p=>{if(!p.box.disabled)p.box.checked=true;}));button('Clear all',controls,()=>c.picks.forEach(p=>{if(!p.box.disabled)p.box.checked=false;}));}
  const disclosure=el('details',null,card);disclosure.open=true;el('summary','Proposed text changes ('+changes.length+')',disclosure);
  if(changes.length){const table=el('table',null,disclosure),head=el('tr',null,el('thead',null,table));['Use','Field','Current Master value','Submitted revision'].forEach(x=>el('th',x,head));const body=el('tbody',null,table);
    changes.forEach(change=>{const tr=el('tr',null,body),item=plan?.items.find(i=>i.kind==='text'&&i.key===change.key),clears=change.newValue==null||change.newValue==='',p=pick(el('td',null,tr),'Use '+change.label,change.key,pending&&change.writable&&(!item||item.state==='deferred'||item.state==='applied'),item?(item.state==='pending'||item.state==='applied')&&(!clears||item.confirmClear):change.writable&&!clears,c);p.change=change;
      el('td',change.label+(change.writable?'':' — '+change.reason)+(item?' — '+(item.state==='applied'?'recorded as applied, but Master still differs; approve again':item.state):'')+(item?.heldReason?' ('+item.heldReason+')':''),tr);el('td',(change.currentDisplayValue??change.currentValue)==null||(change.currentDisplayValue??change.currentValue)===''?'(empty)':(change.currentDisplayValue??change.currentValue),tr);el('td',clears?'(clear this field — unticked by default; tick only to erase the Master value)':change.newValue,tr);
    });
  }else el('p',(row.recordedFields||[]).length?'The submitted values below are already in the Master. No further text update is needed.':'No remaining text changes. Review attachments or recorded outcomes below.',disclosure).className='tonga-positive';
  if(row.recordedFields?.length){const recorded=el('details',null,card);recorded.open=true;el('summary','Submitted values already in Master ('+row.recordedFields.length+')',recorded);const table=el('table',null,recorded);table.className='tonga-recorded-fields';const head=el('tr',null,el('thead',null,table));['Status','Field','Current Master value','Submitted value'].forEach(t=>el('th',t,head));const body=el('tbody',null,table);row.recordedFields.forEach(c=>{const tr=el('tr',null,body);['Already in Master',c.label,c.currentDisplayValue??c.currentValue,c.newValue].forEach(t=>el('td',t===''?'(empty)':t,tr));});
   if(pending&&!changes.length&&!parse(row['Attachments JSON'],[]).length&&!plan?.items.some(i=>['pending','deferred'].includes(i.state)))button('Complete review — already recorded',card,async()=>{if(busy||!confirm('Complete this review? All submitted values are already in Master; no Master values will be changed.'))return;await run(c,()=>saveScholar(c));});
  }
  const structured=parse(row['Structured Submission JSON'],{});
  if(Array.isArray(structured.degrees)&&structured.degrees.length){
   const section=el('section',null,card);section.className='tonga-additional-degree-review';el('h4','Additional degree details — review each degree separately',section);
   el('p',caps.degreeRows?'Use “Load proposals from the form” in the Proposed Master rows section below to add each new degree as its own Graduate Degrees row, or to fill empty fields in the listed Degree ID. Existing values are never overwritten.':'Add new degrees as separate Graduate Degrees rows. For corrections, use the listed Degree ID. Do not overwrite another degree. The degree-details attachment stays pending until its review/import outcome is recorded below.',section);
   structured.degrees.forEach(g=>{const block=el('div',null,section);el('strong',(g.operation==='add'?'New ':'Update ')+(g.level==='phd'?'PhD':'Masters')+' #'+g.number+(g.degreeId?' · '+g.degreeId:''),block);const values=g.values||{};for(const [key,label] of [['university','University'],['country','Country'],['year','Year completed'],['thesis_url','Thesis / degree URL']]){const line=el('p',null,block);line.append(label+': ');if(key==='thesis_url'&&values[key])link(values[key],values[key],line);else line.append(String(values[key]||'(empty)'));}el('p','Thesis upload field: '+g.uploadField,block);});
  }
  if(structured.notes)el('p','Submitter notes: '+structured.notes,card);
  if(plan){const journal=el('details',null,card);el('summary','Recorded item outcomes',journal);plan.items.forEach(x=>el('p',(x.label||x.name||x.key)+': '+x.state+(x.closeNote?' — '+x.closeNote:''),journal));}
  if(pending)renderRemaining(c);
  const files=parse(row['Attachments JSON'],[]),attachments=el('section',null,card);attachments.className='tonga-attachments';el('strong','Attachments ('+files.length+')',attachments);
  files.forEach(f=>{
    const item=el('div',null,attachments);item.className='tonga-attachment';const outcome=plan?.items.find(i=>i.kind==='file'&&i.key===f.fileId);
    const p=pick(item,'Use attachment '+f.name,f.fileId,pending&&(!outcome||outcome.state==='deferred'),outcome?outcome.state==='pending':true,c);p.file=f;
    const content=el('div',null,item);el('strong',f.name||'Attachment',content);el('div',(f.field||'attachment')+(f.size?' · '+Math.round(Number(f.size)/1024)+' KB':'')+(outcome?' · '+outcome.state:''),content).className='meta';
    let dataPromise;p.data=()=>{if(!dataPromise)dataPromise=window.adminWriteback.readSubmissionAttachment(row['Submission ID'],f.fileId).then(checked).catch(e=>{dataPromise=null;throw e;});return dataPromise;};
    if(/^image\/(jpeg|png|webp|gif)$/i.test(f.type||'')||/\.(jpe?g|png|webp|gif)$/i.test(f.name||'')){
      const preview=el('div','',content);preview.className='tonga-attachment-preview';preview.setAttribute('role','status');button('Show preview',preview,()=>p.data().then(a=>{if(!/^image\/(jpeg|png|webp|gif)$/i.test(a.type))throw new Error('Unsupported image format');const img=el('img');img.alt='Submitted attachment preview';img.src='data:'+a.type+';base64,'+a.data;img.onerror=()=>{preview.textContent='Preview unavailable. Use Download original to inspect the file.';};preview.replaceChildren(img);}).catch(e=>{preview.textContent='Preview unavailable: '+e.message+'. Use Download original.';}));
    }
    button('Download original',content,async()=>{try{const a=await p.data(),bytes=Uint8Array.from(atob(a.data),x=>x.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),aLink=el('a');aLink.href=url;aLink.download=a.name;aLink.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){message(e.message,true);}});
    if(pending&&f.field!=='headshot'){
      const label=el('label','Actual file review outcome',content);p.disposition=el('select',null,label);p.disposition.setAttribute('aria-label','Review outcome for '+f.name);
      [['pending','Still requires review / import'],['reviewed_privately','Reviewed privately'],['imported','Import completed']].forEach(([v,t])=>{const o=el('option',t,p.disposition);o.value=v;});
      const evLabel=el('label','Review evidence or imported record IDs',content);p.evidence=el('input',null,evLabel);p.evidence.type='text';p.evidence.setAttribute('aria-label','Review evidence for '+f.name);
      el('p','Checking this file does not import it. Record only review or import work actually completed; otherwise it stays pending.',content).className='meta';
    }
  });
  window.TongaAttachmentReview?.mount(card,row,caps);
 }
 // Plain-language reasons a submission is still Pending, from the saved review record.
 function remainingItems(row){
  const plan=row?.reviewPlan;if(!plan)return [];
  const files=parse(row['Attachments JSON'],[]),proposed=row.proposedChanges||[];
  return plan.items.filter(i=>i.state==='pending'||i.state==='deferred'||(i.kind==='text'&&i.state==='applied'&&proposed.some(x=>x.key===i.key&&x.writable))).map(i=>{
   if(i.kind==='file'){const f=files.find(x=>x.fileId===i.key)||{};const what=i.field==='headshot'||f.field==='headshot'?'photo not yet published (use Resume checked review while signed in as Owner)':'needs a review outcome (choose “Reviewed privately” or “Import completed” with evidence), or close it';return {i,label:(f.name||i.name||'Attachment'),why:what};}
   const p=proposed.find(x=>x.key===i.key);
   const why=i.state==='applied'?'recorded as applied, but Master still differs (tick it above and use Resume checked review)':i.heldReason||(p&&!p.writable?p.reason:p?(p.newValue===''?'blank submitted value (would clear Master); tick to confirm or close':'not ticked yet; tick it and use Resume checked review'):'already handled in Master; close it');
   return {i,label:i.label||i.key,why};});
 }
 function remainingText(row){const items=remainingItems(row);if(!items.length)return '';const files=items.filter(x=>x.i.kind==='file').length,text=items.length-files;return [files&&files+' attachment'+(files>1?'s':'')+' need an outcome',text&&text+' field'+(text>1?'s':'')+' not written to Master'].filter(Boolean).join(' and ');}
 function renderRemaining(c){
  const items=remainingItems(c.row);if(!items.length)return;
  const box=el('details',null,c.card);box.className='tonga-remaining';box.open=true;
  el('summary','Why this is still Pending ('+items.length+' item'+(items.length>1?'s':'')+')',box);
  el('p','A submission leaves the Pending queue only when every item has an outcome. Fix an item above, or tick items here that need no Master change (for example a URL you entered in the Scholar profiles editor, a CV kept on file, or a degree handled through the row proposals) and close them with a short note.',box).className='meta';
  const picks=items.map(x=>{const l=el('label',null,box);l.className='tonga-remaining-item';const cb=el('input',null,l);cb.type='checkbox';cb.setAttribute('aria-label','Close '+x.label+' without a Master change');l.append(' ');el('strong',x.label,l);l.append(' — '+x.why);return {cb,x};});
  if(!caps.closeItems){el('p','Closing items needs Tonga backend 5.1. Paste and deploy the updated Apps Script first.',box).className='tonga-error';picks.forEach(p=>p.cb.disabled=true);return;}
  const nl=el('label','Reason for closing (kept in the review record)',box);const note=el('input',null,nl);note.type='text';note.setAttribute('aria-label','Reason for closing items for '+c.row['Submission ID']);note.placeholder='e.g. Institution URL entered in Scholar profiles editor';
  const go=button('Close ticked items without Master change',box,()=>{
   const chosen=picks.filter(p=>p.cb.checked);if(!chosen.length){message('Tick at least one item in “Why this is still Pending”.',true);return;}
   if(note.value.trim().length<5){message('Add a short reason (at least 5 characters) before closing items.',true);note.focus();return;}
   if(!confirm('Close '+chosen.length+' item(s) for '+(c.row['Scholar Name']||c.row['Scholar ID'])+' without changing the Master? If nothing else remains, the submission moves to Reviewed.'))return;
   run(c,async()=>{const id=c.row['Submission ID'];const out=checked(await window.adminWriteback.closeScholarReviewItems(id,chosen.map(p=>({kind:p.x.i.kind,key:p.x.i.key})),note.value.trim(),c.note?.value||''));
    const row=out.row||(checked(await window.adminWriteback.readScholarSubmission(id)).rows||[]).find(r=>r['Submission ID']===id);
    if(row&&row.Status!=='Pending'){removeCard(c);return 'Closed '+chosen.length+' item(s). Submission complete and moved to Reviewed.';}
    if(row)c._updatedRow=row;return 'Closed '+chosen.length+' item(s). Still pending because '+(remainingText(row)||'other items need a decision')+'.';});
  });go.className='tonga-approve';
 }
 async function run(c,fn){
   if(busy)return;
   if(stale){message('Refresh this queue successfully before saving a review. Your selections are retained.',true);return;}
   busy=true;
   const progress=c&&el('p','Saving and verifying review…',c.card);if(progress){progress.className='tonga-queue-status';progress.setAttribute('role','status');}
   const controls=[...host.querySelectorAll('button,select,input,textarea')],disabled=controls.map(x=>x.disabled);
   controls.forEach(x=>x.disabled=true);
   try{const text=await fn();message(text);if(progress?.isConnected)progress.textContent=text;}
   catch(e){const detail=e.message||String(e);message(detail,true);if(progress){progress.textContent='Review stopped: '+detail;progress.classList.add('tonga-error');}}
   finally{busy=false;controls.forEach((x,i)=>x.disabled=disabled[i]);
    // Rerender only changed cards after controls unlock; other card selections survive.
    cards.filter(x=>x._updatedRow).forEach(x=>{const row=x._updatedRow;delete x._updatedRow;updateCard(x,row);});
    syncSelection();
   }
 }
 async function approveScholar(c){
   if(busy)return;
   if(!caps.selectionReview){message('Deploy the complete Tonga backend v4 before approving scholar updates.',true);return;}
   const chosen=c.picks.filter(p=>p.box.checked);
   if(!chosen.length&&!c.row.reviewPlan?.items.some(x=>x.state==='pending')){message('Check at least one change or attachment.');return;}
   if(!confirm('Approve '+chosen.filter(p=>p.change).length+' checked text revision(s) and review '+chosen.filter(p=>p.file).length+' checked attachment(s)? Unchecked items remain pending.'))return;
   await run(c,()=>saveScholar(c));
 }
 async function saveScholar(c){
   const api=window.adminWriteback,id=c.row['Submission ID'],chosen=c.picks.filter(p=>p.box.checked);
   let out=checked(await api.reviewScholarSelection(id,chosen.filter(p=>p.change&&p.change.writable).map(p=>({key:p.key,expectedCurrent:p.change.currentValue,confirmClear:p.change.newValue==null||p.change.newValue===''})),chosen.filter(p=>p.file).map(p=>p.key),c.note.value));
   c.row.reviewPlan=out.plan||out.row?.reviewPlan;
   let filesChanged=false,notes=[];
   for(const item of (c.row.reviewPlan?.items||[]).filter(x=>x.kind==='file'&&x.state==='pending')){
    const p=c.picks.find(x=>x.file&&x.key===item.key);if(!p)continue;
    try{
     if(p.file.field==='headshot'){
      const result=await window.TongaSubmissionAdmin.approvePhoto(c.row['Scholar ID'],await p.data(),id+':'+p.key);
      checked(await api.recordAttachmentReview(id,p.key,'published',result.path));filesChanged=true;
     }else if(p.disposition.value!=='pending'){
      checked(await api.recordAttachmentReview(id,p.key,p.disposition.value,p.evidence.value));filesChanged=true;
     }
    }catch(e){notes.push(p.file.name+': '+e.message);}
   }
   if(filesChanged){out=checked(await api.finishScholarReview(id,c.note.value));const rows=checked(await api.readScholarSubmission(id)).rows;out.row=rows.find(r=>r['Submission ID']===id);}
   if(out.row){if(out.row.Status!=='Pending')removeCard(c);else c._updatedRow=out.row;}
   const left=remainingText(out.row||c._updatedRow||c.row);
   return (out.remainingReview||left?'Selected work saved. Still pending because '+(left||'some items need a decision')+'. ':'Approved and saved. ')+await refreshPublic()+(notes.length?' Attachment problems: '+notes.join('; '):'');
 }
 function geoKeys(c){if(!c.geoPicks)return undefined;const keys=c.geoPicks.filter(x=>x.checked).map(x=>x.value);if(!keys.length)throw new Error('Select at least one proposed location, or reject this suggestion.');return keys;}
 async function resolveOne(c,decision){
   if(decision==='approve'&&c.geoPicks&&!c.geoPicks.some(x=>x.checked)){message('Select at least one proposed location, or reject this suggestion.',true);return;}
   if(busy||!confirm(decision==='approve'?'Approve this suggestion and append new non-duplicate geography? Existing geography will be preserved.':'Reject '+(scholar?'all remaining items in this submission':'this suggestion')+'? Nothing new will be added; earlier approved work is preserved.'))return;
   await run(c,async()=>{checked(await(scholar?window.adminWriteback.resolveScholarSubmission(c.row['Submission ID'],'reject',c.note.value):window.adminWriteback.resolveGeographySubmission(c.row['Submission ID'],decision,c.note.value,decision==='approve'?geoKeys(c):undefined)));removeCard(c);return (decision==='approve'?'Geography approved. '+await refreshPublic():'Rejected — saved and verified.');});
 }
 async function banSubmitter(c){const reason=prompt('Reason for blocking this submitter in Tonga:');if(!reason?.trim()||!confirm('Block future Tonga submissions from '+c.row['Submitter Email']+'? Reason: '+reason))return;await run(c,async()=>{checked(await window.adminWriteback.banScholarSubmitter(c.row['Submission ID'],reason));return 'Submitter blocked for Tonga. The submission remains available for review.';});}
 async function bulkResolve(){
   if(busy||filter.value!=='Pending'||(scholar&&!caps.selectionReview))return;
   const selected=cards.filter(c=>c.select?.checked);
   if(!selected.length)return;
   const changes=selected.reduce((n,c)=>n+c.picks.filter(p=>p.box.checked).length,0);
   if(!confirm('Approve '+selected.length+' checked submission(s) in this view'+(scholar?' containing '+changes+' selected item(s)':'')+'? Unchecked submissions and fields remain pending.'))return;
   await run(null,async()=>{let saved=0;const failures=[],remaining=[];
    for(const [i,c] of selected.entries()){
     message('Saving '+(i+1)+' of '+selected.length+'…');
     try{if(scholar){await saveScholar(c);if(c._updatedRow?.Status==='Pending')remaining.push((c.row['Scholar Name']||c.row['Scholar ID'])+' — '+(remainingText(c._updatedRow)||'items need a decision'));}else{if(c.row.countryValidationError)throw new Error(c.row.countryValidationError);checked(await window.adminWriteback.resolveGeographySubmission(c.row['Submission ID'],'approve',c.note.value,geoKeys(c)));removeCard(c);}saved++;}
     catch(e){failures.push(c.row['Submission ID']+': '+e.message);}
    }
    const done=saved-remaining.length;
    return saved+' submission(s) processed; '+done+' completed and removed from Pending. '+(remaining.length?remaining.length+' still need work — open each card’s “Why this is still Pending” box: '+remaining.join(' | ')+'. ':'')+(failures.length?'Failed and retained for retry: '+failures.join('; ')+'. ':'')+await refreshPublic();
   });
 }
 function active(){return tab.classList.contains('active')||tab.getAttribute('aria-selected')==='true';}
 function autoRefresh(){
  if(!ready()||!active()||busy)return;
  if(dirty||host.contains(document.activeElement)){if(lastLoaded&&Date.now()-lastLoaded>=30000)freshness.textContent='Review in progress. Refresh queue to check other reviewers’ decisions; your selections and notes will be retained.';return;}
  if(!loaded||Date.now()-lastLoaded>=30000)load();
 }
 filter.onchange=()=>load();tab.addEventListener('click',()=>{if(!busy)load();refreshBadge();});
 setInterval(autoRefresh,30000);window.addEventListener('focus',autoRefresh);document.addEventListener('visibilitychange',autoRefresh);
 if(readyState)new MutationObserver(autoRefresh).observe(readyState,{childList:true,characterData:true,subtree:true});
 setTimeout(autoRefresh,1500);
});
})();
