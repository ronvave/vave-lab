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
async function refreshPublic(){if(window.TongaSubmissionAdmin?.refreshMessage)return window.TongaSubmissionAdmin.refreshMessage;try{return window.TongaSubmissionAdmin&&await window.TongaSubmissionAdmin.refresh({silent:true})?'Public snapshot refresh queued; publication is not yet verified.':'Master saved; public snapshot refresh was not dispatched. Use Refresh from Sheet.';}catch(e){return 'Master saved; public refresh failed: '+e.message;}}
document.querySelectorAll('[data-tonga-queue]').forEach(host=>{
 const kind=host.dataset.tongaQueue,scholar=kind==='scholar';
 const tab=document.querySelector('[data-tab="'+(scholar?'scholar-submissions':'geography-submissions')+'"]');
 const badge=el('span',null,tab);badge.className='tonga-submission-badge';badge.hidden=true;badge.setAttribute('aria-live','polite');
 let badgeBusy=false,badgeGeneration=0,busy=false,loaded=false,caps={},cards=[];
 function showCount(n){badge.textContent=String(n);badge.hidden=n===0;badge.title=n+' pending submissions';badge.setAttribute('aria-label',n+' pending submissions');}
 function ready(){const state=document.getElementById('db-status');return !document.hidden&&(!state||state.textContent.trim()==='ready')&&window.adminWriteback&&window.adminWriteback.isConfigured();}
 const read=status=>scholar?window.adminWriteback.readScholarSubmissions(status):window.adminWriteback.readGeographySubmissions(status);
 async function refreshBadge(){if(badgeBusy||!ready())return;badgeBusy=true;const generation=++badgeGeneration;try{const out=checked(await read('Pending'));if(generation===badgeGeneration)showCount((out.rows||[]).length);}catch(_){badge.title='Pending count could not be refreshed. Open this tab to retry.';}finally{badgeBusy=false;}}
 setTimeout(refreshBadge,1400);setInterval(refreshBadge,30000);window.addEventListener('focus',refreshBadge);document.addEventListener('visibilitychange',refreshBadge);
 const readyState=document.getElementById('db-status');if(readyState)new MutationObserver(refreshBadge).observe(readyState,{childList:true,characterData:true,subtree:true});
 document.addEventListener('change',()=>setTimeout(refreshBadge,0));
 el('p',scholar?'Only values that differ from the live Master file are shown. Text revisions and attachments are checked by default. Uncheck anything you do not want, then approve the checked items.':'Geography suggestions submitted from secure scholar profile links. Review each changed publication before anything is added to Research Geography.',host).className='tonga-queue-helper';
 const toolbar=el('div',null,host);toolbar.className='tonga-queue-toolbar';
 const filter=el('select',null,toolbar);filter.setAttribute('aria-label','Submission status');['Pending',scholar?'Reviewed':'Approved','Rejected','All'].forEach(s=>{const o=el('option',s,filter);o.value=s==='All'?'':s;});
 const refresh=button('Refresh queue',toolbar,()=>load());
 const bulk=el('span',null,toolbar);bulk.className='tonga-bulk-controls';bulk.hidden=true;
 button('Check All',bulk,()=>cards.forEach(c=>{if(c.select)c.select.checked=true;}));button('Clear All',bulk,()=>cards.forEach(c=>{if(c.select)c.select.checked=false;}));button('Approve all checked',bulk,bulkResolve,'tonga-approve');
 const count=el('span','',toolbar);count.className='tonga-queue-count';
 const status=el('p','Open this tab to load submissions.',host);status.className='tonga-queue-status';status.setAttribute('role','status');
 const list=el('div',null,host);
 function message(text,error){status.textContent=text;status.classList.toggle('tonga-error',!!error);}
 function savedState(){const out=new Map();cards.forEach(c=>out.set(c.row['Submission ID'],{note:c.note?.value,selected:c.select?.checked,picks:c.picks.map(p=>[p.key,p.box.checked,p.disposition?.value,p.evidence?.value])}));return out;}
 async function load(after){if(busy)return;busy=true;refresh.disabled=true;filter.disabled=true;message('Loading…');const saved=savedState();try{
   if(!window.adminWriteback||!window.adminWriteback.isConfigured())throw new Error('Configure the Tonga endpoint and shared secret in Data source & GitHub first.');
   const out=checked(await read(filter.value));
   if(scholar){try{caps=checked(await window.adminWriteback.reviewCapabilities());}catch(_){caps={};}}
   if(filter.value==='Pending'){badgeGeneration++;showCount((out.rows||[]).length);}else refreshBadge();
   list.replaceChildren();cards=[];(out.rows||[]).forEach(row=>render(row,saved.get(row['Submission ID'])));
   count.textContent=(out.rows||[]).length+' submission'+((out.rows||[]).length===1?'':'s');bulk.hidden=scholar||filter.value!=='Pending'||!cards.length;
   if(!cards.length)el('p',scholar?'No scholar-profile submissions in this view.':'No submissions in this view.',list).className='meta';
   message(after||'');loaded=true;
 }catch(e){message(e.message,true);}finally{busy=false;refresh.disabled=false;filter.disabled=false;}}
 function pick(parent,label,key,enabled,selected,c){const box=el('input',null,parent);box.type='checkbox';box.setAttribute('aria-label',label);box.disabled=!enabled;box.checked=!!selected;const p={box,key};c.picks.push(p);return p;}
 function render(row,saved){
  const pending=row.Status==='Pending',card=el('article',null,list),c={row,card,picks:[]};cards.push(c);
  card.className='tonga-review tonga-review--'+String(row.Status||'').toLowerCase();
  const top=el('div',null,card);top.className='tonga-review-heading';
  if(!scholar&&pending){const label=el('label',null,top);c.select=el('input',null,label);c.select.type='checkbox';c.select.checked=saved?.selected||false;c.select.setAttribute('aria-label','Select '+(row['Publication Title']||row['Submission ID']));label.append(' Select');}
  const heading=el('div',null,top);el('h3',scholar?(row['Scholar Name']||row['Scholar ID']):(row['Publication Title']||row['Publication Key']),heading);
  el('div',[!scholar&&row['Scholar Name'],row['Scholar ID'],!scholar&&row.Year,row['Submission ID'],row['Submitted At']].filter(Boolean).join(' · '),heading).className='meta';
  el('span',row.Status,top).className='tonga-status-pill';
  const identity=el('p',null,card);identity.className='tonga-submitter';identity.append('Submitted by: '+(row['Submitter Name']||'Unknown')+(row.Relationship?' ('+row.Relationship+')':'')+' · ');link(row['Submitter Email'],'mailto:'+row['Submitter Email'],identity);if(row['Profile URL']){identity.append(' · ');link('Submitted scholar profile',row['Profile URL'],identity);}
  if(scholar)renderScholar(c,pending);else{
    const grid=el('div',null,card);grid.className='tonga-geography-grid';
    chips(grid,'Current Tonga locations',(row.currentTongaLocations||[]).map(locationText));
    if(!Array.isArray(row.currentTongaLocations))el('p',row.currentGeographyError||'Current locations unavailable until the Tonga backend is updated. No locations have been inferred.',grid).className='tonga-error';
    chips(grid,'Proposed Tonga locations',parse(row['Proposed Tonga Locations JSON'],[]).map(locationText));chips(grid,'Proposed Pacific countries',countries(row['Proposed Pacific Countries']));chips(grid,'Proposed other countries',countries(row['Proposed Other Countries']));
  }
  if(!pending){el('p',[row.Resolution,row['Review Notes'],row['Reviewed By'],row['Reviewed At']].filter(Boolean).join(' · '),card);return;}
  const label=el('label','Optional review note',card);label.className='tonga-note-label';c.note=el('textarea',null,label);c.note.value=saved?.note||row.reviewPlan?.note||'';c.note.setAttribute('aria-label','Review note for '+row['Submission ID']);
  const actions=el('div',null,card);actions.className='tonga-review-actions';
  if(scholar){
    const ban=button('Ban submitter',actions,()=>banSubmitter(c),'tonga-ban');ban.disabled=!caps.banSubmitter;if(ban.disabled)ban.title=caps.role==='admin'?'Only the Owner can ban submitters.':'Requires verified Tonga review backend v2.';
   const approve=button(row.reviewPlan?'Resume checked review':'Approve all checked',actions,()=>approveScholar(c),'tonga-approve');approve.disabled=!caps.combinedReview;
   if(row.reviewPlan)el('p','Selections are locked because this review has started. Resume applies the pending items; any problem will appear below this card.',card).className='meta';
    if(!caps.combinedReview)el('p','Combined approval requires Tonga Apps Script review backend v2. Queue reads and secure downloads remain available.',card).className='tonga-error';
  }else button('Approve',actions,()=>resolveOne(c,'approve'),'tonga-approve');
  button(scholar?'Reject all':'Reject',actions,()=>resolveOne(c,'reject'),'tonga-reject');
  if(saved)saved.picks.forEach(([key,value,disposition,evidence])=>{const p=c.picks.find(x=>x.key===key);if(p&&!row.reviewPlan&&!p.box.disabled)p.box.checked=value;if(p?.disposition)p.disposition.value=disposition||'pending';if(p?.evidence)p.evidence.value=evidence||'';});
 }
 function renderScholar(c,pending){
  const {row,card}=c,plan=row.reviewPlan,changes=row.proposedChanges||[];
  if(pending){const controls=el('div',null,card);controls.className='tonga-selection-controls';button('Check all',controls,()=>c.picks.forEach(p=>{if(!p.box.disabled)p.box.checked=true;}));button('Clear all',controls,()=>c.picks.forEach(p=>{if(!p.box.disabled)p.box.checked=false;}));}
  const disclosure=el('details',null,card);disclosure.open=true;el('summary','Proposed text changes ('+changes.length+')',disclosure);
  if(changes.length){const table=el('table',null,disclosure),head=el('tr',null,el('thead',null,table));['Use','Field','Current Master value','Submitted revision'].forEach(x=>el('th',x,head));const body=el('tbody',null,table);
    changes.forEach(change=>{const tr=el('tr',null,body),item=plan?.items.find(i=>i.kind==='text'&&i.key===change.key),p=pick(el('td',null,tr),'Use '+change.label,change.key,pending&&change.writable&&!plan,item?item.selected:change.writable,c);p.change=change;
      el('td',change.label+(change.writable?'':' — '+change.reason)+(item?' — '+item.state:''),tr);el('td',change.currentValue==null||change.currentValue===''?'(empty)':change.currentValue,tr);el('td',change.newValue==null||change.newValue===''?'(clear this field)':change.newValue,tr);
    });
  }else el('p','No text differences from the live Master file. Review any attachments below.',disclosure).className='tonga-positive';
  const structured=parse(row['Structured Submission JSON'],{});if(structured.notes)el('p','Submitter notes: '+structured.notes,card);
  if(plan){const journal=el('details',null,card);el('summary','Recorded item outcomes',journal);plan.items.forEach(x=>el('p',(x.label||x.name||x.key)+': '+x.state,journal));}
  const files=parse(row['Attachments JSON'],[]),attachments=el('section',null,card);attachments.className='tonga-attachments';el('strong','Attachments ('+files.length+')',attachments);
  files.forEach(f=>{
    const item=el('div',null,attachments);item.className='tonga-attachment';const outcome=plan?.items.find(i=>i.kind==='file'&&i.key===f.fileId);
    const p=pick(item,'Use attachment '+f.name,f.fileId,pending&&!plan,outcome?outcome.selected:true,c);p.file=f;
    const content=el('div',null,item);el('strong',f.name||'Attachment',content);el('div',(f.field||'attachment')+(f.size?' · '+Math.round(Number(f.size)/1024)+' KB':'')+(outcome?' · '+outcome.state:''),content).className='meta';
    let dataPromise;p.data=()=>{if(!dataPromise)dataPromise=window.adminWriteback.readSubmissionAttachment(row['Submission ID'],f.fileId).then(checked).catch(e=>{dataPromise=null;throw e;});return dataPromise;};
    if(/^image\/(jpeg|png|webp|gif)$/i.test(f.type||'')||/\.(jpe?g|png|webp|gif)$/i.test(f.name||'')){
      const preview=el('div','Loading secure preview…',content);preview.className='tonga-attachment-preview';preview.setAttribute('role','status');p.data().then(a=>{if(!/^image\/(jpeg|png|webp|gif)$/i.test(a.type))throw new Error('Unsupported image format');const img=el('img');img.alt='Submitted attachment preview';img.src='data:'+a.type+';base64,'+a.data;img.onerror=()=>{preview.textContent='Preview unavailable. Use Download original to inspect the file.';};preview.replaceChildren(img);}).catch(e=>{preview.textContent='Preview unavailable: '+e.message+'. Use Download original.';});
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
   const progress=c&&el('p','Review in progress…',c.card);if(progress){progress.className='tonga-queue-status';progress.setAttribute('role','status');}
   const controls=[...host.querySelectorAll('button,select,input,textarea')],disabled=controls.map(x=>x.disabled);
   controls.forEach(x=>x.disabled=true);
   try{const text=await fn();busy=false;await load(text);}
   catch(e){const detail=e.message||String(e);message(detail,true);if(progress){progress.textContent='Review stopped: '+detail;progress.classList.add('tonga-error');}}
   finally{busy=false;controls.forEach((x,i)=>x.disabled=disabled[i]);if(c?.row.reviewPlan){c.picks.forEach(p=>p.box.disabled=true);const resume=c.card.querySelector('.tonga-review-actions .tonga-approve');if(resume)resume.textContent='Resume checked review';}refreshBadge();}
 }
 async function approveScholar(c){
   if(busy)return;
   const chosen=c.picks.filter(p=>p.box.checked),text=chosen.filter(p=>p.change&&p.change.writable),files=chosen.filter(p=>p.file);
   if(!c.row.reviewPlan&&!confirm('Accept '+text.length+' checked text revision(s) and '+files.length+' checked attachment(s). Unchecked items will be rejected. Files requiring review/import remain pending until that work is recorded. Continue?'))return;
   await run(c,async()=>{
     const api=window.adminWriteback,id=c.row['Submission ID'];let plan=c.row.reviewPlan,masterChanged=false,notes=[];
     if(!plan)plan=checked(await api.beginScholarReview(id,text.map(p=>({key:p.key,expectedCurrent:p.change.currentValue})),files.map(p=>p.key),c.note.value)).plan;
     // Keep the durable selection locally if a later operation fails.
     c.row.reviewPlan=plan;
     if(plan.items.some(x=>x.kind==='text'&&x.state==='pending')){
       const response=await api.approveScholarSubmission(id,[],c.note.value);
       if(response?.results?.some(r=>r.status==='ok'||r.status==='already_satisfied'))masterChanged=true;
       if(response?.status!=='ok'){
         const rejected=(response?.results||[]).filter(r=>!['ok','already_satisfied'].includes(r.status)).map(r=>[r.field||r.key||r.change?.field,r.reason||r.status].filter(Boolean).join(': '));
         const error=new Error(response?.error||response?.reason||rejected.join('; ')||response?.status||'Approval failed');
         if(masterChanged)error.message+=' '+await refreshPublic();throw error;
       }
       const out=checked(response);plan=out.plan;masterChanged=true;
     }
     for(const item of plan.items.filter(x=>x.kind==='file'&&x.state==='pending')){
       const p=c.picks.find(x=>x.file&&x.key===item.key);if(!p)continue;
       try{
         if(p.file.field==='headshot'){
           const result=await window.TongaSubmissionAdmin.approvePhoto(c.row['Scholar ID'],await p.data(),id+':'+p.key);
           checked(await api.recordAttachmentReview(id,p.key,'published',result.path));
         }else if(p.disposition.value!=='pending'){
           checked(await api.recordAttachmentReview(id,p.key,p.disposition.value,p.evidence.value));
         }
       }catch(e){notes.push(p.file.name+': '+e.message);}
     }
     const result=checked(await api.finishScholarReview(id,c.note.value));
     let msg=result.remainingReview?'Review remains Pending: '+result.pending+' item(s) need work. Successful items are recorded for safe retry.':'Review completed. Per-item outcomes recorded.';
     if(masterChanged)msg+=' '+await refreshPublic();if(notes.length)msg+=' File errors: '+notes.join('; ');return msg;
   });
 }
 async function resolveOne(c,decision){
   if(busy||!confirm(decision==='approve'?'Approve this suggestion and append new non-duplicate geography? Existing geography will be preserved.':'Reject '+(scholar?'all remaining items in this submission':'this suggestion')+'? Nothing new will be added; earlier approved work is preserved.'))return;
   await run(c,async()=>{checked(await(scholar?window.adminWriteback.resolveScholarSubmission(c.row['Submission ID'],'reject',c.note.value):window.adminWriteback.resolveGeographySubmission(c.row['Submission ID'],decision,c.note.value)));return (decision==='approve'?'Geography approved. '+await refreshPublic():'Rejected. No new Master changes.');});
 }
 async function banSubmitter(c){const reason=prompt('Reason for blocking this submitter in Tonga:');if(!reason?.trim()||!confirm('Block future Tonga submissions from '+c.row['Submitter Email']+'? Reason: '+reason))return;await run(c,async()=>{checked(await window.adminWriteback.banScholarSubmitter(c.row['Submission ID'],reason));return 'Submitter blocked for Tonga. The submission remains available for review.';});}
 async function bulkResolve(){
   if(busy||filter.value!=='Pending')return;const visible=cards.filter(c=>c.select),yes=visible.filter(c=>c.select.checked).length,no=visible.length-yes;
   if(!visible.length||!confirm('APPROVE '+yes+' checked submission(s) AND REJECT '+no+' unchecked visible Pending submission(s). Rejections add no geography. Continue?'))return;
   await run(null,async()=>{let approved=0,rejected=0;const failures=[];
     for(const c of visible){const decision=c.select.checked?'approve':'reject';try{checked(await window.adminWriteback.resolveGeographySubmission(c.row['Submission ID'],decision,c.note.value));if(decision==='approve')approved++;else rejected++;}catch(e){failures.push(c.row['Submission ID']+': '+e.message);}}
     return approved+' approved; '+rejected+' rejected. '+(failures.length?'Failed and retained for retry: '+failures.join('; '):'All decisions succeeded.')+(approved?' '+await refreshPublic():'');
   });
 }
 filter.onchange=()=>load();tab.addEventListener('click',()=>{if(!loaded)load();refreshBadge();});
});
})();
