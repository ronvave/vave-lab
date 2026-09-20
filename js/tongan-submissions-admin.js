/* Tonga-only review UI. Apps Script owns validation, diffs and writes. */
(function () {
'use strict';
function el(tag,text,parent){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(parent)parent.append(n);return n;}
function parse(s,f){try{return JSON.parse(s);}catch(_){return f;}}
function checked(r){if(!r||r.status!=='ok')throw new Error(r&&(r.error||r.reason||r.status)||'No server response');return r;}
document.querySelectorAll('[data-tonga-queue]').forEach(host=>{
 const kind=host.dataset.tongaQueue;
 const tab=document.querySelector('[data-tab="'+(kind==='scholar'?'scholar-submissions':'geography-submissions')+'"]');
 const badge=el('span',null,tab);badge.className='tonga-submission-badge';badge.hidden=true;badge.setAttribute('aria-live','polite');
 let badgeBusy=false,badgeGeneration=0;
 function showCount(n){badge.textContent=String(n);badge.hidden=n===0;badge.title=n+' pending submissions';badge.setAttribute('aria-label',n+' pending submissions');}
 function ready(){const state=document.getElementById('db-status');return !document.hidden&&(!state||state.textContent.trim()==='ready')&&window.adminWriteback&&window.adminWriteback.isConfigured();}
 async function refreshBadge(){
  if(badgeBusy||!ready())return;
  badgeBusy=true;const generation=++badgeGeneration;
  try{const api=window.adminWriteback,out=checked(await(kind==='scholar'?api.readScholarSubmissions('Pending'):api.readGeographySubmissions('Pending')));if(generation===badgeGeneration)showCount((out.rows||[]).length);}
  catch(_){badge.title='Pending count could not be refreshed. Open this tab to retry.';}
  finally{badgeBusy=false;}
 }
 // Read counts without rerendering review cards or discarding unsaved notes.
 setTimeout(refreshBadge,1400);
 setInterval(refreshBadge,30000);
 window.addEventListener('focus',refreshBadge);
 document.addEventListener('visibilitychange',refreshBadge);
 const readyState=document.getElementById('db-status');
 if(readyState)new MutationObserver(refreshBadge).observe(readyState,{childList:true,characterData:true,subtree:true});
 document.addEventListener('change',()=>setTimeout(refreshBadge,0));
 el('p',kind==='scholar'?'Review differences against the live Master. Only checked, writable fields are applied. Attachments and supplementary links need separate review.':'Approved locations are added to Research Geography; existing locations are preserved. Rejection makes no Master changes.',host);
 const filter=el('select',null,host);filter.setAttribute('aria-label','Submission status');
 ['Pending',kind==='scholar'?'Reviewed':'Approved','Rejected','All'].forEach(s=>{const o=el('option',s,filter);o.value=s==='All'?'':s;});
 const refresh=el('button','Refresh queue',host),status=el('p','Open this tab to load submissions.',host),list=el('div',null,host);status.className='tonga-queue-status';status.setAttribute('role','status');let busy=false,loaded=false;
 async function load(){if(busy)return;busy=true;refresh.disabled=true;status.textContent='Loading…';try{const api=window.adminWriteback;if(!api||!api.isConfigured())throw new Error('Configure the Tonga endpoint and shared secret in Data source & GitHub first.');const out=checked(await(kind==='scholar'?api.readScholarSubmissions(filter.value):api.readGeographySubmissions(filter.value)));if(filter.value==='Pending'){badgeGeneration++;showCount((out.rows||[]).length);}else refreshBadge();list.replaceChildren();(out.rows||[]).forEach(render);status.textContent=(out.rows||[]).length+' submissions. Approved Master changes appear after the next snapshot refresh.';loaded=true;}catch(e){status.textContent=e.message;}finally{busy=false;refresh.disabled=false;}}
 function render(row){
  const card=el('article',null,list);card.className='tonga-review';el('h3',(row['Scholar Name']||row['Scholar ID'])+' — '+row.Status,card);el('p',[row['Submission ID'],row['Submitted At'],row['Submitter Name'],row['Submitter Email'],row.Relationship].filter(Boolean).join(' · '),card);const picks=[];
  if(kind==='scholar'){
   const table=el('table',null,card),head=el('tr',null,el('thead',null,table));['Apply','Field','Current Master value','Submitted value'].forEach(x=>el('th',x,head));const body=el('tbody',null,table);
   (row.proposedChanges||[]).forEach(c=>{const tr=el('tr',null,body),box=el('input',null,el('td',null,tr));box.type='checkbox';box.checked=!!c.writable;box.disabled=!c.writable||row.Status!=='Pending';box.setAttribute('aria-label','Approve '+c.label);picks.push({box,change:c});el('td',c.label+(c.writable?'':' — '+c.reason),tr);el('td',c.currentValue||'(empty)',tr);el('td',c.newValue||'(clear this field)',tr);});
   const structured=parse(row['Structured Submission JSON'],{});if(structured.notes)el('p','Submitter notes: '+structured.notes,card);
   const files=parse(row['Attachments JSON'],[]);
   const attachments=el('section',null,card);attachments.className='tonga-attachments';
   el('strong','Attachments ('+files.length+')',attachments);
   if(!files.length)el('p','No attachment was received with this submission.',attachments).className='meta';
   files.forEach(f=>{
    const item=el('div',null,attachments);item.className='tonga-attachment';
    el('strong',f.name||'Attachment',item);
    el('div',(f.field||'attachment')+(f.size?' · '+Math.round(Number(f.size)/1024)+' KB':''),item).className='meta';
    let dataPromise;
    function data(){if(!dataPromise)dataPromise=window.adminWriteback.readSubmissionAttachment(row['Submission ID'],f.fileId).then(checked).catch(e=>{dataPromise=null;throw e;});return dataPromise;}
    const isImage=/^image\/(jpeg|png|webp|gif)$/i.test(f.type||'')||/\.(jpe?g|png|webp|gif)$/i.test(f.name||'');
    if(isImage){
     const preview=el('div','Loading secure preview…',item);preview.className='tonga-attachment-preview';preview.setAttribute('role','status');
     data().then(a=>{if(!/^image\/(jpeg|png|webp|gif)$/i.test(a.type))throw new Error('Not a supported image');const img=el('img');img.alt='Submitted attachment preview';img.src='data:'+a.type+';base64,'+a.data;img.onerror=()=>{preview.textContent='Preview unavailable. Use Download to inspect the original.';};preview.replaceChildren(img);}).catch(e=>{preview.textContent='Preview unavailable: '+e.message;});
    }
    const download=el('button','Download original',item);download.type='button';
    download.onclick=async()=>{download.disabled=true;try{const a=await data(),bytes=Uint8Array.from(atob(a.data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),link=el('a');link.href=url;link.download=a.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status.textContent=e.message;}finally{download.disabled=false;}};
    if(row.Status==='Pending'&&f.field==='headshot'&&/^image\/jpeg$/i.test(f.type)){
     const approve=el('button','Approve this headshot',item);approve.type='button';
     approve.onclick=async()=>{if(!confirm('Publish this submitted headshot to the scholar profile?'))return;approve.disabled=true;try{await window.TongaSubmissionAdmin.approvePhoto(row['Scholar ID'],await data());el('p','Headshot saved. Record this in the review notes before closing the submission.',item);approve.remove();}catch(e){status.textContent=e.message;approve.disabled=false;}};
    }
   });
   if(files.length)el('p','Attachments require separate review. Approve headshots above; review CVs and thesis files and import bibliography records into the Master before marking the review complete.',attachments).className='meta';
  }else{el('h4',row['Publication Title'],card);el('p','Publication key: '+row['Publication Key'],card);parse(row['Proposed Tonga Locations JSON'],[]).forEach(l=>el('p',l.national?'Tonga — general/national study':[l.division,l.district,l.island,l.village].filter(Boolean).join(' · '),card));el('p','Pacific countries: '+(row['Proposed Pacific Countries']||'None'),card);el('p','Other countries: '+(row['Proposed Other Countries']||'None'),card);}
  if(row.Status!=='Pending'){el('p',[row['Review Notes'],row.Resolution,row['Reviewed By'],row['Reviewed At']].filter(Boolean).join(' · '),card);return;}
  const notes=el('textarea',null,card);notes.placeholder='Review notes, including how attachments were handled';notes.setAttribute('aria-label','Review notes');const actions=el('div',null,card);actions.className='tonga-review-actions';
  function action(label,run){const b=el('button',label,actions);b.onclick=async()=>{if(busy)return;busy=true;card.querySelectorAll('button').forEach(x=>x.disabled=true);try{checked(await run());busy=false;await load();}catch(e){status.textContent=e.message;card.querySelectorAll('button').forEach(x=>x.disabled=false);}finally{busy=false;}};}
  if(kind==='scholar'){
   action('Approve checked fields',()=>{const selected=picks.filter(p=>p.box.checked&&!p.box.disabled).map(p=>({key:p.change.key,expectedCurrent:p.change.currentValue}));if(!selected.length)throw new Error('Select at least one writable field.');return window.adminWriteback.approveScholarSubmission(row['Submission ID'],selected,notes.value);});
   action('Mark remaining review complete',()=>{if(!notes.value.trim())throw new Error('Describe how the remaining fields and attachments were handled.');if(!confirm('Close this review? Remaining fields and attachments will not be applied.'))throw new Error('Review left pending.');return window.adminWriteback.resolveScholarSubmission(row['Submission ID'],'reviewed',notes.value);});
  }else action('Approve geography',()=>window.adminWriteback.resolveGeographySubmission(row['Submission ID'],'approve',notes.value));
  action('Reject submission',()=>{if(!confirm('Reject this submission? Previously approved changes, if any, remain.'))throw new Error('Submission left pending.');return kind==='scholar'?window.adminWriteback.resolveScholarSubmission(row['Submission ID'],'reject',notes.value):window.adminWriteback.resolveGeographySubmission(row['Submission ID'],'reject',notes.value);});
 }
 refresh.onclick=load;filter.onchange=load;tab.addEventListener('click',()=>{if(!loaded)load();refreshBadge();});
});
})();
