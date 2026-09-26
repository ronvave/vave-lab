/* Shared Owner/Admin attachment analysis UI. Text and originals remain private. */
(function(){
'use strict';
const E=(tag,text,parent)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(parent)parent.append(n);return n;};
function B(text,parent,fn){const b=E('button',text,parent);b.type='button';b.onclick=fn;return b;}
function ok(r){if(r?.status!=='ok')throw Error(r?.error||r?.reason||'Attachment request failed');return r;}
const labels={title:'Current title / role',institution:'Current institution',department:'Department / unit',masters_university:"Master’s university",masters_country:"Master’s country",masters_year:"Master’s completion year",masters_thesis_url:"Master’s thesis URL",phd_university:'PhD university',phd_country:'PhD country',phd_year:'PhD completion year',phd_thesis_url:'PhD thesis URL'};
let pdfLibrary;
async function pdfPages(attachment,progress){
 const bytes=Uint8Array.from(atob(attachment.data),c=>c.charCodeAt(0));
 const fingerprint=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))));
 if(!pdfLibrary)pdfLibrary=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs').catch(e=>{pdfLibrary=null;throw e;});
 const pdfjs=await pdfLibrary;pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs';
 const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,disableFontFace:true,useSystemFonts:false});
 let pdf;try{pdf=await task.promise;if(pdf.numPages>100)throw Error('CV is over 100 pages; review it manually');const pages=[];
 for(let page=1;page<=pdf.numPages;page++){
  progress('Reading CV page '+page+' of '+pdf.numPages+'…');const p=await pdf.getPage(page),content=await p.getTextContent();let text='',lastY=null;
  for(const item of content.items){if(typeof item.str!=='string')continue;const y=item.transform?.[5];if(lastY!=null&&y!=null&&Math.abs(y-lastY)>3&&!text.endsWith('\n'))text+='\n';text+=item.str+(item.hasEOL?'\n':' ');lastY=y;}
  pages.push({page,text});p.cleanup();
 }return{pages,fingerprint};
 }finally{await task.destroy();}
}
window.TongaAttachmentReview={mount(host,row,caps){
 const files=JSON.parse(row['Attachments JSON']||'[]');if(!files.length)return;
 const box=E('section',null,host);box.className='tonga-attachment-analysis';E('h4','Attachment analysis & proposed changes',box);
 E('p','Read CV PDFs and BibTeX / EndNote / RIS references, compare with the Master, then approve individual proposals. Extracted proposals start unchecked. Nothing is imported by analysing a file.',box).className='meta';
 if(!caps.attachmentAnalysis){E('p','Attachment analysis is awaiting the updated Tonga backend.',box);return;}
 let a=null,busy=false,selection=new Set(),loaded=false;
 const tools=E('div',null,box);tools.className='tonga-review-actions';
 const status=E('p','',box);status.setAttribute('role','status');
 const content=E('div',null,box);
 function say(s,error=false){status.textContent=s;status.classList.toggle('tonga-error',error);}
 async function run(fn){if(busy)return;busy=true;const disabled=[...box.querySelectorAll('button,input,select,textarea')].map(n=>[n,n.disabled]);disabled.forEach(([n])=>n.disabled=true);
 try{await fn();}catch(e){say(e.message,true);}finally{busy=false;disabled.forEach(([n,d])=>n.disabled=d);draw();}}
 async function load(){a=ok(await window.adminWriteback.readAttachmentAnalysis(row['Submission ID'])).analysis;loaded=true;}
 B('Show saved analysis',tools,()=>run(async()=>{await load();say(a?'Saved analysis loaded.':'No saved analysis yet. Choose Analyse attachments.');}));
 const analyse=B('Analyse attachments',tools,()=>run(async()=>{
  await load();let failures=[];
  for(const f of files){if(a?.files.some(x=>x.fileId===f.fileId))continue;say('Analysing '+f.name+'… Keep this tab open. Each completed file is saved.');
   try{let params={submissionId:row['Submission ID'],fileId:f.fileId};
    if(/\.pdf$/i.test(f.name)&&f.field==='cv'){const data=ok(await window.adminWriteback.readSubmissionAttachment(row['Submission ID'],f.fileId));Object.assign(params,await pdfPages(data,t=>say(f.name+': '+t)));}
    a=ok(await window.adminWriteback.analyseScholarAttachment(params)).analysis;
   }catch(e){failures.push(f.name+': '+e.message);}
  }
  say(failures.length?'Completed files saved. Retry analysis for: '+failures.join('; '):'Analysis saved. Review the evidence and select the changes you want.',!!failures.length);
 }));analyse.disabled=row.Status!=='Pending';
 function field(parent,label,value){const l=E('label',label,parent),input=E('input',null,l);input.value=value??'';return input;}
 function cvEditor(parent,item,file){
  const d=E('details',null,parent);E('summary',item?'Edit / refresh proposed value':'Add a proposal from this CV',d);const form=E('div',null,d);form.className='tonga-proposal-form';
  const fl=E('label','Master field',form),key=E('select',null,fl);Object.entries(labels).forEach(([v,t])=>{E('option',t,key).value=v;});key.value=item?.key||'title';
  const value=field(form,'Proposed value',item?.value||''),page=field(form,'Source page',item?.source?.match(/\d+/)?.[0]||1);page.type='number';page.min=1;page.max=file.pages;
  B('Save proposal for review',form,()=>run(async()=>{a=ok(await window.adminWriteback.editAttachmentProposal({submissionId:row['Submission ID'],revision:a.revision,kind:'profile',itemId:item?.id,fileId:file.fileId,key:key.value,value:value.value,page:Number(page.value)})).analysis;say('Proposal saved. Check it when you are ready to approve.');}));
 }
 function publicationEditor(parent,item){const d=E('details',null,parent);E('summary','Edit / refresh proposed metadata and author position',d);const form=E('div',null,d);form.className='tonga-proposal-form';const inputs={};
  ['title','year','doi','url','venue','publisher'].forEach(k=>inputs[k]=field(form,k==='doi'?'DOI':k[0].toUpperCase()+k.slice(1),item.record[k]));
  const l=E('label','This scholar in the source author list',form),pos=E('select',null,l);E('option','Choose author…',pos).value='0';item.record.authors.forEach((name,i)=>E('option',(i+1)+'. '+name,pos).value=String(i+1));pos.value=String(item.authorPosition||0);
  B('Save proposal for review',form,()=>run(async()=>{const record=Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]));a=ok(await window.adminWriteback.editAttachmentProposal({submissionId:row['Submission ID'],revision:a.revision,itemId:item.id,record,authorPosition:Number(pos.value)})).analysis;say('Metadata refreshed against the current Master. Review again before approval.');}));
 }
 function proposal(item,parent){const card=E('div',null,parent);card.className='tonga-analysis-item';
  const active=['pending','needs_review'].includes(item.state)&&row.Status==='Pending';const top=E('label',null,card);
  if(active){const check=E('input',null,top);check.type='checkbox';check.checked=selection.has(item.id);check.onchange=()=>check.checked?selection.add(item.id):selection.delete(item.id);check.setAttribute('aria-label','Select '+(item.record?.title||item.label));}
  E('strong',(item.record?.title||item.label)+' — '+({pending:'Review proposal',needs_review:'Needs attention',existing:'Already recorded',duplicate:'Duplicate in uploads',applied:'Approved',dismissed:'Not accepted'}[item.state]||item.state),top);
  E('p',item.fileName+' · '+(item.source||item.record?.source||'')+(item.reviewedBy?' · '+item.reviewedBy+' · '+item.reviewedAt:''),card).className='meta';
  if(item.reason)E('p',item.reason,card).className='meta';if(item.error)E('p',item.error,card).className='tonga-error';
  const table=E('table',null,card),head=E('tr',null,E('thead',null,table));['Change','Current Master','Proposed'].forEach(t=>E('th',t,head));const body=E('tbody',null,table);
  function diff(label,old,value){const tr=E('tr',null,body);[label,old||'(empty)',value||'(empty)'].forEach(t=>E('td',String(t),tr));}
  if(item.kind==='profile'){diff(item.label,item.change?.currentValue||((item.state==='existing')?item.value:''),item.value);const evidence=E('details',null,card);E('summary','Source evidence',evidence);E('pre',item.evidence,evidence);if(active||item.state==='existing')cvEditor(card,item,a.files.find(x=>x.fileId===item.fileId));}
  else{
   if(item.publicationId){diff('Authorship link',item.linked?'Already linked':'Not linked',item.linked?'Retain existing link':'Link to this scholar');item.updates.forEach(u=>diff(u.field,u.current,u.value));}
   else ['title','year','publicationType','doi','url','venue','publisher'].forEach(k=>{if(item.record[k])diff(k,'Not in Master',item.record[k]);});
   if(item.cvEvidence?.length){const cv=E('details',null,card);E('summary','Compare with CV evidence ('+item.cvEvidence.length+' pages)',cv);item.cvEvidence.forEach(e=>{E('p',e.fileName+' · page '+e.page,cv);E('pre',e.excerpt,cv);});}
   E('p','Source authors: '+item.record.authors.map((x,i)=>(i+1)+'. '+x).join('; '),card);
   E('p',item.authorPosition?'Proposed scholar author position: '+item.authorPosition+' — verify this is the correct person.':'Choose the scholar’s author position before approval.',card).className=item.authorPosition?'meta':'tonga-error';
   if(active||item.state==='existing')publicationEditor(card,item);
  }
 }
 function draw(){if(!loaded)return;content.replaceChildren();if(!a)return;
  const totals={};a.items.forEach(i=>totals[i.state]=(totals[i.state]||0)+1);
  E('p',a.files.length+' of '+files.length+' attachments analysed · '+(totals.pending||0)+' proposals · '+(totals.needs_review||0)+' need attention · '+(totals.existing||0)+' already recorded · '+(totals.duplicate||0)+' duplicates · '+(totals.applied||0)+' approved',content).className='tonga-analysis-summary';
  a.files.forEach(f=>{const d=E('details',null,content);E('summary',f.name+(f.records?' — '+f.records+' reference records':'')+(f.pages?' — '+f.pages+' CV pages':'')+(f.status==='manual'?' — manual review':''),d);f.warnings.forEach(w=>E('p',w,d));
   if(f.sections){f.sections.forEach(s=>{const e=E('details',null,d);E('summary','Page '+s.page+' · '+s.section,e);E('pre',s.excerpt,e);});if(row.Status==='Pending')cvEditor(d,null,f);}
  });
  if(row.Status==='Pending'){const controls=E('div',null,content);controls.className='tonga-review-actions';
   B('Check ready proposals',controls,()=>{a.items.filter(i=>i.state==='pending').forEach(i=>selection.add(i.id));draw();});B('Clear checks',controls,()=>{selection.clear();draw();});
   const decide=decision=>run(async()=>{const itemIds=[...selection].filter(id=>a.items.some(i=>i.id===id&&['pending','needs_review'].includes(i.state)));if(!itemIds.length){say('Select at least one proposal.');return;}if(!confirm((decision==='dismiss'?'Decline ':'Approve ')+itemIds.length+' selected attachment proposals? Unchecked proposals remain pending.'))return;
    for(let start=0;start<itemIds.length;start+=5){say('Saving proposals '+(start+1)+'–'+Math.min(start+5,itemIds.length)+' of '+itemIds.length+'…');a=ok(await window.adminWriteback.approveAttachmentProposals({submissionId:row['Submission ID'],revision:a.revision,itemIds:itemIds.slice(start,start+5),decision})).analysis;}selection.clear();say(a.items.some(i=>i.error)?'Some proposals could not be saved. Their errors are shown below.':'Selected outcomes saved. Public profiles update after the next data refresh.');
   });B('Approve selected proposals',controls,()=>decide('approve')).className='tonga-approve';B('Decline selected proposals',controls,()=>decide('dismiss'));
  }
  a.items.filter(i=>!['existing','duplicate','applied','dismissed'].includes(i.state)).forEach(i=>proposal(i,content));
  const done=a.items.filter(i=>['existing','duplicate','applied','dismissed'].includes(i.state));if(done.length){const d=E('details',null,content);E('summary','Already recorded, duplicates & completed outcomes ('+done.length+')',d);done.forEach(i=>proposal(i,d));}
  E('p','Analysis does not close the submission. After reviewing every attachment, record its actual review outcome in the attachment section above. Unchecked proposals remain available here.',content).className='meta';
 }
}};
})();
