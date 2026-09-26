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
async function refreshPublic(){return 'Master saved. Public profiles update after the next successful scheduled data refresh.';}
let countRequest=null,countAt=0;
async function queueCounts(){if(!countRequest||Date.now()-countAt>30000){countAt=Date.now();countRequest=window.adminWriteback.reviewQueueCounts().then(checked).catch(e=>{countRequest=null;throw e;});}return countRequest;}
document.querySelectorAll('[data-tonga-queue]').forEach(host=>{
 const kind=host.dataset.tongaQueue,scholar=kind==='scholar';
 const tab=document.querySelector('[data-tab="'+(scholar?'scholar-submissions':'geography-submissions')+'"]');
 const badge=el('span',null,tab);badge.className='tonga-submission-badge';badge.hidden=true;badge.setAttribute('aria-live','polite');
 let badgeBusy=false,badgeGeneration=0,busy=false,loaded=false,caps={},cards=[];
 function showCount(n){badge.textContent=String(n);badge.hidden=n===0;badge.title=n+' pending submissions';badge.setAttribute('aria-label',n+' pending submissions');}
 function ready(){const state=document.getElementById('db-status');return !document.hidden&&(!state||state.textContent.trim()==='ready')&&window.adminWriteback&&window.adminWriteback.isConfigured();}
 const read=status=>scholar?window.adminWriteback.readScholarSubmissions(status):window.adminWriteback.readGeographySubmissions(status);
 async function refreshBadge(){if(busy||badgeBusy||!ready()||!window.adminWriteback.reviewQueueCounts)return;badgeBusy=true;const generation=++badgeGeneration;try{const out=await queueCounts();if(generation===badgeGeneration)showCount(out[kind]||0);}catch(_){badge.title='Pending count could not be refreshed. Open this tab to retry.';}finally{badgeBusy=false;}}
 setTimeout(refreshBadge,1400);setInterval(refreshBadge,30000);window.addEventListener('focus',refreshBadge);document.addEventListener('visibilitychange',refreshBadge);
 const readyState=document.getElementById('db-status');if(readyState)new MutationObserver(refreshBadge).observe(readyState,{childList:true,characterData:true,subtree:true});

 el('p',scholar?'Only values that differ from the live Master file are shown. Text revisions and attachments are checked by default. Uncheck anything you do not want, then approve the checked items.':'Geography suggestions submitted from secure scholar profile links. Review each changed publication before anything is added to Research Geography.',host).className='tonga-queue-helper';
 const toolbar=el('div',null,host);toolbar.className='tonga-queue-toolbar';
 const filter=el('select',null,toolbar);filter.setAttribute('aria-label','Submission status');['Pending',scholar?'Reviewed':'Approved','Rejected','All'].forEach(s=>{const o=el('option',s,filter);o.value=s==='All'?'':s;});
 const refresh=button('Refresh queue',toolbar,()=>load());
 const bulk=el('span',null,toolbar);bulk.className='tonga-bulk-controls';bulk.hidden=true;
 button('Check all',bulk,()=>{cards.forEach(c=>{if(c.select)c.select.checked=true;});syncSelection();});
 button('Clear selection',bulk,()=>{cards.forEach(c=>{if(c.select)c.select.checked=false;});syncSelection();});
 const bulkApprove=button('Approve all checked',bulk,bulkResolve,'tonga-approve'),selectionCount=el('span','',bulk);
 function syncSelection(){const n=cards.filter(c=>c.select?.checked).length;selectionCount.textContent=n+' selected in this view';bulkApprove.disabled=busy||!n||(scholar&&!caps.selectionReview);}
 host.addEventListener('change',syncSelection);
 function syncCount(){count.textContent=cards.length+' submissions in this view';bulk.hidden=filter.value!=='Pending'||!cards.length;if(filter.value==='Pending'){badgeGeneration++;showCount(cards.length);}syncSelection();}
 function removeCard(c){c.card.remove();cards=cards.filter(x=>x!==c);syncCount();countRequest=null;}
 function updateCard(c,row){const saved=savedState().get(c.row['Submission ID']),before=c.card.nextSibling;removeCard(c);if(!filter.value||row.Status===filter.value){render(row,saved);const fresh=cards[cards.length-1];list.insertBefore(fresh.card,before);if(busy)fresh.card.querySelectorAll('button,input,textarea,select').forEach(x=>x.disabled=true);}syncCount();}

 const count=el('span','',toolbar);count.className='tonga-queue-count';
 const status=el('p','Open this tab to load submissions.',host);status.className='tonga-queue-status';status.setAttribute('role','status');
 const list=el('div',null,host);
 function message(text,error){status.textContent=text;status.classList.toggle('tonga-error',!!error);}
 function savedState(){const out=new Map();cards.forEach(c=>out.set(c.row['Submission ID'],{note:c.note?.value,selected:c.select?.checked,picks:c.picks.map(p=>[p.key,p.box.checked,p.disposition?.value,p.evidence?.value])}));return out;}
 async function load(after){if(busy)return;busy=true;refresh.disabled=true;filter.disabled=true;message('Loading…');const saved=savedState();try{
   if(!window.adminWriteback||!window.adminWriteback.isConfigured())throw new Error('Configure the Tonga endpoint and shared secret in Data source & GitHub first.');
   const out=checked(await read(filter.value));
   if(scholar&&!caps.version){try{caps=checked(await window.adminWriteback.reviewCapabilities());}catch(_){caps={};}}
   if(filter.value==='Pending'){badgeGeneration++;showCount((out.rows||[]).length);}else refreshBadge();
   list.replaceChildren();cards=[];(out.rows||[]).forEach(row=>render(row,saved.get(row['Submission ID'])));
   syncCount();
   if(!cards.length)el('p',scholar?'No scholar-profile submissions in this view.':'No submissions in this view.',list).className='meta';
   message(after||'');loaded=true;
 }catch(e){message((after?after+' Queue display could not reload: ':'')+e.message,true);}finally{busy=false;refresh.disabled=false;filter.disabled=false;syncSelection();}}
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
    changes.forEach(change=>{const tr=el('tr',null,body),item=plan?.items.find(i=>i.kind==='text'&&i.key===change.key),p=pick(el('td',null,tr),'Use '+change.label,change.key,pending&&change.writable&&(!item||item.state==='deferred'),item?item.state==='pending':change.writable,c);p.change=change;
      el('td',change.label+(change.writable?'':' — '+change.reason)+(item?' — '+item.state:''),tr);el('td',change.currentValue==null||change.currentValue===''?'(empty)':change.currentValue,tr);el('td',change.newValue==null||change.newValue===''?'(clear this field)':change.newValue,tr);
    });
  }else el('p','No text differences from the live Master file. Review any attachments below.',disclosure).className='tonga-positive';
  const structured=parse(row['Structured Submission JSON'],{});if(structured.notes)el('p','Submitter notes: '+structured.notes,card);
  if(plan){const journal=el('details',null,card);el('summary','Recorded item outcomes',journal);plan.items.forEach(x=>el('p',(x.label||x.name||x.key)+': '+x.state,journal));}
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
 }
 async function run(c,fn){
   if(busy)return;
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
   let out=checked(await api.reviewScholarSelection(id,chosen.filter(p=>p.change&&p.change.writable).map(p=>({key:p.key,expectedCurrent:p.change.currentValue})),chosen.filter(p=>p.file).map(p=>p.key),c.note.value));
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
   return (out.remainingReview?'Selected work saved; remaining items stay Pending. ':'Approved and saved. ')+await refreshPublic()+(notes.length?' Attachment work remains: '+notes.join('; '):'');
 }
 async function resolveOne(c,decision){
   if(busy||!confirm(decision==='approve'?'Approve this suggestion and append new non-duplicate geography? Existing geography will be preserved.':'Reject '+(scholar?'all remaining items in this submission':'this suggestion')+'? Nothing new will be added; earlier approved work is preserved.'))return;
   await run(c,async()=>{checked(await(scholar?window.adminWriteback.resolveScholarSubmission(c.row['Submission ID'],'reject',c.note.value):window.adminWriteback.resolveGeographySubmission(c.row['Submission ID'],decision,c.note.value)));removeCard(c);return (decision==='approve'?'Geography approved. '+await refreshPublic():'Rejected — saved and verified.');});
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
     try{if(scholar){const result=await saveScholar(c);if(c._updatedRow?.Status==='Pending')remaining.push(c.row['Submission ID']+': '+result);}else{if(c.row.countryValidationError)throw new Error(c.row.countryValidationError);checked(await window.adminWriteback.resolveGeographySubmission(c.row['Submission ID'],'approve',c.note.value));removeCard(c);}saved++;}
     catch(e){failures.push(c.row['Submission ID']+': '+e.message);}
    }
    return saved+' submission(s) processed. Unchecked work remains pending. '+(failures.length?'Failed and retained for retry: '+failures.join('; '):'')+' '+(remaining.length?'Still pending: '+remaining.join('; '):'')+' '+await refreshPublic();
   });
 }
 filter.onchange=()=>load();tab.addEventListener('click',()=>{if(!loaded)load();refreshBadge();});
});
})();
