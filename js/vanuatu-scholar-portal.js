/* Vanuatu scholar sharing and reviewed submissions (ported from the Tonga/Samoa profile portal). No admin credentials here.
 * Submissions go only to the private Vanuatu Master review queues; nothing is public until the owner approves and refreshes. */
(function(){
'use strict';
const ENDPOINT='https://script.google.com/macros/s/AKfycbwVPbJqKkMh6GXjftGz6OhPn0fHR-KxIYPWhAAwThmC0Nt2gJP7y5HsNOGiweSIqaYv/exec';
const G=window.VanuatuGeography||{provinces:[],inhabitedIslands:{}};
const PROVINCES=G.provinces.slice();
const PACIFIC=['American Samoa','Australia','Cook Islands','Fiji','French Polynesia','Guam','Kiribati','Marshall Islands','Micronesia (Federated States of)','Nauru','New Caledonia','New Zealand','Niue','Northern Mariana Islands','Palau','Papua New Guinea','Pitcairn','Samoa','Solomon Islands','Tokelau','Tuvalu','Wallis and Futuna'];
const q=new URLSearchParams(location.search),sidParam=String(q.get('scholar')||'').toUpperCase();if(/^VAN-S\d{4,}$/.test(sidParam))window.__vanuatuSharedScholar={scholarId:sidParam};
const isPreview=()=>!!(window.VanuatuBundle&&window.VanuatuBundle.isPreview&&window.VanuatuBundle.isPreview());
function el(tag,text,parent){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(parent)parent.append(n);return n;}
function profileURL(id){const u=new URL('s-vanuatu.html',location.href);u.search='';u.hash='';u.searchParams.set('scholar',id);if(isPreview())u.searchParams.set('preview','1');return u.href;}
async function send(body){body=Object.assign({website:'',elapsedMs:Date.now()-OPENED},body);let cap;try{cap=await fetch(ENDPOINT+'?action=submissionCapabilities',{cache:'no-store'}).then(r=>r.json());}catch(_){cap=null;}if(!cap||cap.status!=='ok'||cap.country!=='Vanuatu'||!cap.publicSubmissionsEnabled)throw new Error('Vanuatu submissions are not open yet. Your entries remain here; please try again once submissions are enabled.');const result=await fetch(ENDPOINT,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)}).then(r=>r.json());if(result.status!=='ok')throw new Error(result.reason||result.error||result.status||'Submission failed');return result;}
const OPENED=Date.now();
function wireShare(card,row){const column=card.querySelector('.db-scholar-card__photo-col');if(!column||!row.scholarId)return;const b=el('button','Share',column);b.type='button';b.className='db-scholar-card__submit vanuatu-share';b.onclick=async e=>{e.stopPropagation();b.disabled=true;try{const url=profileURL(row.scholarId);try{await navigator.clipboard.writeText(url);}catch(_){const input=el('textarea',url,document.body);input.select();const ok=document.execCommand('copy');input.remove();if(!ok)throw new Error('Copy unavailable. Please copy this link: '+url);}b.textContent='Copied!';b.classList.add('copied');setTimeout(()=>{b.textContent='Share';b.classList.remove('copied');},1600);}catch(err){b.textContent='Try again';b.title=err.message;alert(err.message);}finally{b.disabled=false;}};}
function input(parent,label,value='',type='text',options){const wrap=el('label',label,parent),n=el(options?'select':type==='textarea'?'textarea':'input',null,wrap);if(options){el('option','',n).value='';options.forEach(v=>{const o=el('option',v,n);o.value=v;});}else if(type!=='textarea')n.type=type;n.value=value==null?'':String(value);return n;}
function section(form,title){const fs=el('fieldset',null,form);el('legend',title,fs);return fs;}
function dialog(title){const d=el('dialog',null,document.body);d.className='vanuatu-form';const heading=el('h2',title,d);heading.id='vanuatu-update-title';heading.tabIndex=-1;d.setAttribute('aria-labelledby',heading.id);d.addEventListener('close',()=>d.remove());const form=el('form',null,d);form.method='dialog';const status=el('p','',d);status.setAttribute('role','status');d.showModal();heading.focus();return{d,form,status};}
function showSubmissionConfirmation(submissionId){
 document.querySelector('.vanuatu-submission-confirmation')?.remove();
 const notice=el('section',null,document.body);notice.className='vanuatu-submission-confirmation';
 const message=el('p',null,notice);message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 message.textContent='Your update was submitted successfully and is awaiting review. Reference: '+submissionId+'. Your public profile will change only after approval and the next data refresh.';
 const close=el('button','Dismiss',notice);close.type='button';close.setAttribute('aria-label','Dismiss submission confirmation');close.onclick=()=>notice.remove();
}
function identity(form){const fs=section(form,'Who is submitting');const name=input(fs,'Your name'),email=input(fs,'Your email','','email'),relationship=input(fs,'Relationship to this scholar','','text',['Self','Family','Friend','Student','Colleague','Other']);[name,email,relationship].forEach(n=>n.required=true);return()=>({submitterName:name.value.trim(),submitterEmail:email.value.trim(),submitterRelationship:relationship.value});}
function base(row){return{scholarId:row.scholarId,scholarName:row.name,profileUrl:profileURL(row.scholarId)};}
function clean(v){return /^(unknown|unclassified|n\/a)$/i.test(String(v||'').trim())?'':String(v||'');}
async function openUpdate(row,state){
 const profile=(state.scholarProfilesByName&&state.scholarProfilesByName.get(row.name))||row;
 const sid=row.scholarId||profile.scholarId;row=Object.assign({},profile,row,{scholarId:sid});
 const {d,form,status}=dialog('Update info for this scholar');
 el('p','Correcting / adding info for '+row.name+'. Fields below are pre-filled with the information the public dashboard is currently showing. Edit only what you want to add, remove or correct.',form).className='vanuatu-form-subtitle';
 const notice=el('div',null,form);notice.className='vanuatu-review-notice';el('strong','Please read: ',notice);notice.append(document.createTextNode('corrections are reviewed by the dashboard curator, before the public profile is updated, so changes will not appear immediately. Ideally, edits should be submitted by the scholar themselves. However, friends, family, students and colleagues can also submit updates on their behalf.'));
 const who=identity(form),fields=[],files=[];
 const identitySet=form.querySelector('fieldset');identitySet.querySelector('legend').textContent='Who is submitting this';
 identitySet.querySelectorAll('input,select').forEach(n=>{const mark=el('span',' *');mark.className='vanuatu-required';n.parentElement.insertBefore(mark,n);});
 const relationship=identitySet.querySelector('select');relationship.parentElement.classList.add('wide');relationship.options[0].textContent='Select one…';
 function add(fs,key,label,value,options,type){const n=input(fs,label,clean(value),type||'text',options),initial=n.value;n.name=key;fields.push({key,n,initial});if(options)n.options[0].textContent='(select)';if(type==='url')n.placeholder='https://…';return n;}
 function wide(n){n.parentElement.classList.add('wide');return n;}
 function hint(n,text){el('small',text,n.parentElement);return n;}
 function upload(fs,key,label,accept,text,full=false){const n=input(fs,label,'','file');n.name=key;n.accept=accept;files.push({key,n});if(full)wide(n);if(text)hint(n,text);return n;}
 const names=section(form,'Name shown on your public profile');
 const nameHelp=el('p','Enter the given and family names you want people to see. Given names can include your first and middle names; omit any middle names you do not want displayed. Your full canonical name is retained in the Master file. Changes require Admin approval.',names);nameHelp.className='wide vanuatu-field-help';
 const given=add(names,'Given Names','Given name(s)',profile.first||'');
 const family=add(names,'Family Name','Family name',profile.last||'');
 [given,family].forEach(n=>{n.maxLength=120;});
 const preview=el('p','',names);preview.className='wide vanuatu-field-help';preview.setAttribute('aria-live','polite');
 const showName=()=>{preview.textContent='Public name preview: '+[given.value.trim(),family.value.trim()].filter(Boolean).join(' ');};
 given.addEventListener('input',showName);family.addEventListener('input',showName);showName();
 for(const side of ['paternal','maternal']){
   const publicSide=side==='paternal',prefix=publicSide?'Paternal':'Maternal',fs=section(form,prefix+' geography');fs.className='vanuatu-geography-'+side;
  if(!publicSide){const help=el('p','Optional. Maternal information is for internal research/database purposes and will not be displayed on the public dashboard or scholar profile.',fs);help.className='wide vanuatu-field-help';}
   add(fs,prefix+' Province',prefix+' Province',publicSide?profile.paternalProvince:'',PROVINCES);
   add(fs,prefix+' Island',prefix+' Island',publicSide?profile.paternalIsland:'');
   add(fs,prefix+' Area Council / Locality',prefix+' Area Council / Locality',publicSide?profile.paternalDistrict:'');
   add(fs,prefix+' Village / Community',prefix+' Village / Community',publicSide?profile.paternalVillage:'');
 }
 const fs=section(form,'Scholar profile');
 add(fs,'Salutation','Salutation',profile.salutation,['Dr','Prof','Rev','Rev Dr','Mr','Mrs','Ms']);
 add(fs,'Current Title / Role','Professional title',profile.title);
 wide(add(fs,'Current Institution','Institution',profile.institution));
 add(fs,'Institution Country','Institution country',profile.institutionCountry);
 add(fs,'Current Department / Unit','Department',profile.department);
 add(fs,'Current Profile URL','Faculty profile URL',profile.profileUrl,null,'url');
 add(fs,'Google Scholar URL','Google Scholar URL',profile.googleScholarUrl,null,'url');
 add(fs,'ORCID / Researcher ID','ORCID iD',profile.orcidUrl,null,'url');
 upload(fs,'headshot','High-resolution headshot (JPEG)','.jpg,.jpeg,image/jpeg','Please upload a clear, high-resolution headshot as a JPEG (.jpg or .jpeg).',true);
 // Positions checklist: every recorded position, ticked = shown on the card.
 const degreeEntries=[];
 const ordinal=n=>n+(n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th'));
 for(const [level,title] of [['masters','Masters'],['phd','PhD']]){
  const group=el('div',null,form);group.className='vanuatu-degree-group';
  const rows=(state.master.gradDegrees||state.master.grad||state.master.degrees||[]),matches=rows.filter(g=>g['Scholar ID']===sid&&(level==='masters'?/master/i:/phd|doctor/i).test(g['Degree Stage']||''));
  let count=0,addButton;
  function addDegree(g={},existing=false){
   const number=++count,label=number===1?title:ordinal(number)+' '+title;
   const f=section(group,label);f.className='vanuatu-degree-entry';
   if(addButton)group.insertBefore(f,addButton);
   // Legacy keys remain safe only when there is a single existing degree.
   const legacy=false,prefix=legacy?level:level+'_'+number;
   const entry={level,number,degreeId:g['Degree ID']||'',existing,inputs:{},initial:{},legacy};degreeEntries.push(entry);
   function degreeField(key,text,value,type){const n=legacy?add(f,prefix+'_'+key,text,value,null,type):input(f,text,clean(value),type||'text');n.name=prefix+'_'+key;entry.inputs[key]=n;entry.initial[key]=n.value;return n;}
   const fallback=number===1&&!matches.length;
   const first=degreeField('university',label+' — University',g['C_Uni name']||g['O_Uni name']||(fallback?profile[level+'University']:''));
   degreeField('country',label+' — Country',g.Country||(fallback?profile[level+'Country']:''));
   degreeField('year',label+' — Year completed',g['Finish / Completion Year']);
   hint(degreeField('thesis_url','Link to '+label+' thesis / degree',g['Thesis / Repository URL'],'url'),'Provide a direct university/repository link where possible.');
   entry.upload=upload(f,prefix+'_thesis','Upload '+label+' thesis PDF','.pdf,application/pdf','Optional PDF. The uploaded filename includes the Scholar ID.');
   entry.uploadField=prefix+'_thesis';
   if(addButton){addButton.textContent='Add a '+ordinal(count+1)+' '+title;first.focus();}
  }
  if(matches.length)addDegree(matches[0],true);else addDegree();
  addButton=el('button','Add a '+ordinal(count+1)+' '+title,group);addButton.type='button';addButton.className='vanuatu-add-degree';addButton.onclick=()=>{const recorded=matches[count];addDegree(recorded||{},!!recorded);};
 }
 function degreeChanges(){return degreeEntries.filter(e=>!e.legacy&&(Object.keys(e.inputs).some(k=>e.inputs[k].value!==e.initial[k])||e.upload.files.length)).map(e=>({level:e.level,number:e.number,degreeId:e.degreeId,operation:e.existing?'update':'add',values:Object.fromEntries(Object.entries(e.inputs).map(([k,n])=>[k,n.value.trim()])),previous:e.initial,uploadField:e.uploadField}));}
 const cv=section(form,'CV (optional)');upload(cv,'cv','Upload your latest CV (PDF)','.pdf,application/pdf','Your CV is for internal review only and will not be shared further or displayed on the public dashboard.',true);
 const pubs=section(form,'Publications to add');upload(pubs,'publications','BibTeX or EndNote file','.bib,.ris,.enw','Attach one file containing all the publications you want added. BibTeX (.bib) is preferred; an EndNote export (.enw or .ris) is also fine.',true);
 const notes=wide(input(pubs,'Anything else we should know?','','textarea'));notes.rows=3;notes.placeholder='Optional — e.g. context on which fields you edited, or corrections that don’t fit above.';
 el('p','Attachments: up to 12 MB per file and 30 MB total. Up to 6 files per submission (5 when additional degree details are included). You can use thesis links instead of PDFs.',form).className='vanuatu-field-help';
 const actions=el('div',null,form);actions.className='vanuatu-form-actions';const cancel=el('button','Cancel',actions);cancel.type='button';cancel.className='vanuatu-form-cancel';cancel.onclick=()=>d.close();const button=el('button','Submit for review',actions);button.type='submit';
 let submitting=false,submitted=false;
 form.onsubmit=async e=>{e.preventDefault();if(submitting||submitted||!form.reportValidity())return;submitting=true;button.disabled=true;status.textContent='Submitting…';try{const changed={};fields.forEach(f=>{if(f.n.value!==f.initial)changed[f.key]=f.n.value.trim();});for(const key of ['Given Names','Family Name']){if(Object.prototype.hasOwnProperty.call(changed,key)&&(!changed[key]||/^[=+@\-]/.test(changed[key])))throw new Error('Enter a valid '+(key==='Given Names'?'given name':'family name')+'.');}const degrees=degreeChanges();let degreeSummary='';const selected=files.filter(f=>f.n.files.length);if(selected.length+(degrees.length?1:0)>6)throw new Error('Too many attachments. Use thesis links or submit remaining PDFs in another update.');let total=0;const attachments=[];for(const f of selected){const file=f.n.files[0];total+=file.size;if(file.size>12*1024*1024||total>30*1024*1024)throw new Error('Attachments exceed the size limit.');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});attachments.push({field:f.key,name:sid+'-'+(/_thesis$/.test(f.key)?f.key+'-':'')+file.name,type:file.type||'application/octet-stream',data});}if(degrees.length){degreeSummary=degrees.map(g=>(g.operation==='add'?'Add ':'Update ')+g.level+' #'+g.number+(g.degreeId?' ('+g.degreeId+')':'')).join('; ');const detail=JSON.stringify({scholarId:sid,degrees},null,2);attachments.push({field:'degree_details',name:sid+'-additional-degree-details.json',type:'application/json',data:btoa(unescape(encodeURIComponent(detail)))});}if(!Object.keys(changed).length&&!attachments.length&&!notes.value.trim())throw new Error('Change at least one field, add a note or attach a file.');const result=await send(Object.assign(base(row),who(),{action:'submitScholarProfileUpdate',fields:changed,structuredSubmission:{changedFieldsOnly:true,notes:notes.value.trim(),degreeSummary,degrees},files:attachments}));submitted=true;d.close();showSubmissionConfirmation(result.submissionId);}catch(err){status.textContent=err.message;button.disabled=false;}finally{submitting=false;}};
}
function vanuatuOptions(){
 // Provinces (DLA registry) with their inhabited islands (VNSO 2020 census list) from js/vanuatu-geography.js.
 const options=[{value:'national',label:'Vanuatu — general / national study',location:{national:true}}];
 for(const province of PROVINCES){
  options.push({value:'province:'+province,label:province+' Province',location:{province},group:true});
  (G.inhabitedIslands[province]||[]).slice().sort((a,b)=>a.localeCompare(b)).forEach(island=>options.push({value:'island:'+province+':'+island,label:island,location:{province,island},island:true}));
 }
 return options;
}
function checkMenu(parent,label,options,selected,onChange){
 const details=el('details',null,parent);details.className='vanuatu-geo-menu';
 const summary=el('summary',null,details);el('span',label,summary);const count=el('span','',summary);count.className='vanuatu-geo-count';el('span','▾',summary).setAttribute('aria-hidden','true');
 const panel=el('div',null,details);panel.className='vanuatu-geo-options';
 const checks=options.map(opt=>{const lab=el('label',null,panel);lab.className=opt.island?'vanuatu-geo-island':opt.group?'vanuatu-geo-group':'';const cb=el('input',null,lab);cb.type='checkbox';cb.value=opt.value;cb.checked=selected.has(opt.value);cb.disabled=cb.checked;el('span',opt.label,lab);if(cb.checked)lab.title='Already approved; existing locations are preserved.';cb.onchange=()=>{sync();onChange();};return cb;});
 function sync(){const n=checks.filter(c=>c.checked).length;count.textContent=n?String(n):'';count.hidden=!n;}
 details.addEventListener('toggle',()=>{if(details.open)document.querySelectorAll('.vanuatu-geo-menu[open]').forEach(n=>{if(n!==details)n.open=false;});});
 sync();return{details,checks,values:()=>checks.filter(c=>c.checked&&!c.disabled).map(c=>c.value)};
}
function buildGeographyToolbar(li,item,options,dirty,updateCount){
 const toolbar=el('div',null,li);toolbar.className='vanuatu-geo-toolbar';toolbar.setAttribute('aria-label','Study locations for '+item.title);
 const approved=item._masterGeographyRows||[],selected=new Set();
 for(const g of approved){if(g.country!=='Vanuatu')continue;const province=G.province?G.province(g.district):g.district,island=G.island?G.island(g.specificIsland):g.specificIsland;if(island&&province&&PROVINCES.includes(province))selected.add('island:'+province+':'+island);else if(province&&PROVINCES.includes(province)&&!island&&!g.site)selected.add('province:'+province);else if(!province&&!island&&(!g.site||/national|general/i.test(g.geographyType||'')))selected.add('national');}
 const national=checkMenu(toolbar,'Vanuatu',options,selected,changed);
 const canonical=v=>VanuatuCountries.resolve(v)?.name||v;
 const pacific=checkMenu(toolbar,'Pacific Island country',PACIFIC.map(c=>({value:canonical(c),label:canonical(c)})),new Set(approved.map(g=>canonical(g.country))),changed);
 const other=VanuatuCountryInputs(toolbar,String(window.__vanuatuSharedScholar?.scholarId||'')+':'+item._masterPublicationId,changed,[...new Set(approved.map(g=>canonical(g.country)).filter(c=>c&&c!=='Vanuatu'&&!PACIFIC.map(canonical).includes(c)))]);
 const status=el('p','',toolbar);status.className='vanuatu-geo-item-status';status.setAttribute('role','status');
 function changed(){
  const loc=national.values().map(v=>options.find(o=>o.value===v).location),pac=pacific.values();
  const existingCountries=new Set(approved.map(g=>canonical(g.country).toLowerCase()));
  const countries=other.values().filter(c=>c!=='Vanuatu'&&!pac.includes(c)&&!existingCountries.has(c.toLowerCase()));
  if(loc.length||pac.length||countries.length){dirty.set(item._masterPublicationId,{item_key:item._masterPublicationId,title:item.title,year:item.year,vanuatu_locations:loc,pacific_countries:pac,other_countries:countries});status.textContent='Selections ready to submit below.';}else{dirty.delete(item._masterPublicationId);status.textContent='';}updateCount();
 }
 other.restore();
 return{invalid:()=>other.invalid(),validate:()=>other.validate(),submitted(){[...national.checks,...pacific.checks].forEach(cb=>{if(cb.checked)cb.disabled=true;});other.submitted();status.textContent='Valid locations submitted for review. Any invalid country entries remain in your draft.';},toolbar};
}
function buildGeographySubmit(main,row,dirty,editors,list){
 const form=el('form',null,main);form.className='vanuatu-geo-submit';el('h3','Submit publication geography for review',form);el('p','Select locations beside the publications above, then submit them together. Approved locations are preserved; new suggestions appear publicly only after review and a data refresh.',form);const who=identity(form);
 const button=el('button','Submit geography for review',form);button.type='submit';const count=el('span','0 publications changed',form);count.className='vanuatu-geo-dirty-count';const status=el('p','',form);status.setAttribute('role','status');
 function updateCount(){count.textContent=dirty.size+' publication'+(dirty.size===1?'':'s')+' changed';}
 form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;if(!dirty.size){status.textContent='Select or enter at least one new study location above.';return;}
  const invalid=[...editors.values()].flatMap(editor=>{editor.validate();return editor.invalid();});
  if(invalid.length&&!confirm('These invalid entries will NOT be submitted: '+invalid.join('; ')+'. They remain in your draft if device saving succeeded. Submit valid locations only?'))return;
  const changes=[...dirty.values()];if(changes.some(c=>c.vanuatu_locations.length>30)){status.textContent='Please select no more than 30 Vanuatu locations per publication.';return;}
  const controls=[...list.querySelectorAll('input,select,button'),...form.querySelectorAll('input,select,button')],disabled=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);let completed=0;status.textContent='Submitting…';
  try{for(let i=0;i<changes.length;i+=100){const batch=changes.slice(i,i+100);await send(Object.assign(base(row),who(),{action:'submitPublicationGeography',changes:batch}));batch.forEach(c=>dirty.delete(c.item_key));completed+=batch.length;updateCount();}status.textContent=completed+' publication'+(completed===1?'':'s')+' submitted to the Vanuatu Admin panel for review. Thank you.';}
  catch(err){status.textContent=(completed?completed+' publications submitted. Remaining selections are retained. ':'')+err.message;}
  finally{controls.forEach((n,i)=>n.disabled=disabled[i]);changes.filter(c=>!dirty.has(c.item_key)).forEach(c=>editors.get(c.item_key).submitted());}
 };return updateCount;
}
document.addEventListener('click',e=>{document.querySelectorAll('.vanuatu-geo-menu[open]').forEach(n=>{if(!n.contains(e.target))n.open=false;});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const menus=document.querySelectorAll('.vanuatu-geo-menu[open]');if(menus.length){e.preventDefault();menus.forEach(n=>{n.open=false;n.querySelector('summary').focus();});}}});
async function renderShared(state,renderCard,renderItem){
 const {scholarId}=window.__vanuatuSharedScholar,profile=Array.from(state.scholarProfilesByName.values()).find(p=>p.scholarId===scholarId);if(!profile)throw new Error('Scholar not found in the current snapshot.');
 const counts=state.masterAdapter.computePublicationTotals(state.master,scholarId,{excludePreprints:true,excludeDocuments:true}),row=Object.assign({},profile,{total:counts.total,firstAuthored:counts.firstAuthored,types:counts.types,_authorshipGap:counts.gap});
 const main=el('main');main.className='vanuatu-portal';
 const banner=document.querySelector('.page-banner')?.cloneNode(true);
 const logo=document.querySelector('.nav-logo')?.cloneNode(true);
 const header=el('header');header.className='vanuatu-profile-header';if(logo)header.append(logo);
 const sprites=document.querySelector('svg:has(symbol)')?.cloneNode(true);
 const intro=el('section',null,main);intro.className='vanuatu-portal-intro';
 intro.innerHTML=`
 <div class="direct-review-badge">PRE-LAUNCH PROFILE REVIEW</div>
 <p><strong>About this database.</strong> The Vanuatu Scholarly Research Database is an evolving resource highlighting the scholarship and contributions of ni-Vanuatu and part-ni-Vanuatu postgraduates and researchers in Vanuatu and around the world. The project is led and curated by <a href="https://ronvave.github.io/vave-lab/" target="_blank" rel="noopener">Assistant Professor Ron Vave</a>, an Indigenous Fijian (iTaukei) scholar at the University of Hawaiʻi at Mānoa, in collaboration with <a href="https://www.univ.edu.vu/organization-structure/" target="_blank" rel="noopener">Mr Jean-Pierre Nirua</a>, Vice-Chancellor of the <a href="https://www.univ.edu.vu/" target="_blank" rel="noopener">National University of Vanuatu</a>. It is part of a regional scholarly database initiative that Dr. Vave is spearheading through UH Mānoa’s <a href="https://hawaii.edu/cpis/" target="_blank" rel="noopener">Center for Pacific Islands Studies</a>, and a sister project to the Scholarly Research Database for Pacific Island countries such as Fiji, Tonga, Samoa and Solomon Islands. This initiative is being developed across Pacific Island countries to support the visibility, networking, collaboration and mentorship of Indigenous students and researchers, while making our scholarship more accessible to wider audiences. As an ongoing passion project, this database is not comprehensive and is slowly being added to. <strong>The database and dashboard remain under development and have not yet been publicly launched.</strong></p>
 <p><strong>Why you have been sent this link.</strong> You have been sent a direct link to this scholar profile so the information can be checked and improved.</p>
 <p class="direct-review-callout"><strong>If this is your scholar profile, please scroll down to see your Scholar Profile card, click on Update info to add, remove or change details.</strong></p>
 <p>You can provide missing paternal geography, current professional information, graduate-study details and publication information. You can also attach your latest <strong>CV</strong>, upload a <strong>high-resolution JPEG headshot</strong>, and provide either a direct link to or a PDF copy of your Master’s and/or PhD thesis. <strong>Your CV will only be used to extract relevant information for this database, such as publications, awards, positions and related scholarly information. It will not be shared further and will not be displayed on the scholar dashboard.</strong></p>
 <p><strong>Maternal information is optional.</strong> If you choose to provide it, it will be used only for internal research/database purposes and <strong>will not be displayed on the public dashboard or scholar profile.</strong></p>
 <p>All submissions are reviewed before changes appear. After public launch, this permanent profile link can also be shared by the scholar, recruiters, collaborators, students and others who want a direct view of the scholar’s profile.</p>`;
 el('h2','Current database totals',main).className='vanuatu-summary-heading';
 for(const selector of ['.db-section--overview','.db-section--itaukei']){const panel=document.querySelector(selector)?.cloneNode(true);if(panel){
  panel.classList.add('vanuatu-summary');
  const hint=panel.querySelector('.db-section__hint');
  if(hint)hint.textContent=selector==='.db-section--overview'
   ? 'Statistics for the entire indexed database of research on Vanuatu, regardless of the authors’ ethnicity. These totals cover recorded publications, authors and theses, the universities and countries represented, and Vanuatu provinces studied.'
   : 'Statistics filtered to publications and graduate research involving identified ni-Vanuatu scholars. These totals highlight lead authorship and co-authorship, recorded theses, and the universities and countries represented in ni-Vanuatu graduate study.';
  main.append(panel);
 }}
 const source=document.querySelector('[data-panel="B2"]');
 if(source){const summary=el('section',null,main);summary.className='db-section tph-panel vanuatu-summary vanuatu-summary--b2';const value=k=>source.querySelector('[data-b2-kpi="'+k+'"]')?.textContent||'0';
  // Same image header as A1/A2 above (and the Fiji profile page): flag thumbprint, title, summary and header art.
  const heroModel=main.querySelector('.vanuatu-summary .tph-hero'),hero=el('div',null,summary);hero.className='tph-hero';if(heroModel)hero.setAttribute('style',heroModel.getAttribute('style')||'');
  const art=el('span',null,hero);art.className='tph-art';art.setAttribute('aria-hidden','true');const artModel=heroModel&&heroModel.querySelector('.tph-art');if(artModel)art.setAttribute('style',artModel.getAttribute('style')||'');
  const flag=el('img',null,hero);flag.className='tph-flag';flag.src='img/vanuatu/flag-fingerprint.webp';flag.alt='';flag.setAttribute('aria-hidden','true');
  const text=el('div',null,hero);text.className='tph-text';el('div','VANUATU GRADUATES — GLOBAL DATABASE',text).className='db-section__label';
  el('p',`The database currently records ${value('theses')} Master’s and PhD theses completed by ${value('scholars')} ni-Vanuatu scholars across ${value('unis')} universities in ${value('countries')} countries, comprising ${value('masters')} Master’s theses and ${value('phd')} PhD theses.`,text).className='db-section__hint';
  const tiles=source.querySelector('[data-b2-kpis]');if(tiles)summary.append(tiles.cloneNode(true));}
 const card=renderCard(row);main.append(card);card.title='Scholar profile';
 const ids=new Set((state.master.authorship||[]).filter(a=>a['Scholar ID']===scholarId).map(a=>a['Publication ID / BibTeX Key']));const items=state.snapshot.items.filter(it=>ids.has(it._masterPublicationId));
 const pubHead=el('section',null,main);pubHead.className='vanuatu-portal-intro vanuatu-publications-head';el('h2','Publications currently linked to this scholar',pubHead);
 el('p',items.length+' publications are shown below using the same records, publication-type colors and working DOI/source links as the main dashboard.',pubHead);
 const guidance=el('p',null,pubHead);guidance.innerHTML='<strong class="scholar-geotag-highlight">Please help us geotag your research.</strong> For each thesis, book, book chapter, journal article or report, use the <strong>Vanuatu</strong> dropdown to select the provinces or islands where the study was undertaken. Islands are listed beneath their province. Use <strong>Vanuatu — general / national study</strong> where the work concerns Vanuatu broadly and is not tied to a particular locality. Where relevant, identify another Pacific Island country or territory. For research outside the Pacific, use <strong>Other countries</strong> and choose how many country fields to add. Select one country or area per field from the suggestions. You can select multiple locations for each publication, then use <strong>Submit geography for review</strong> below the publication list.';
 el('p','Geotagging allows publications to appear when the database is filtered by study location. This helps government agencies, Non-Government Organizations (NGOs), Civil Society Organizations (CSOs), and local communities find research undertaken in their province or island and draw on it in planning and decision making. Geographic suggestions are reviewed before they are added to the database. Existing approved study locations are shown with each publication and are preserved when you suggest additional locations.',pubHead);
 const list=el('ul',null,main);list.className='db-items vanuatu-geography-list';
 const dirty=new Map(),editors=new Map(),options=vanuatuOptions();let updateCount=()=>{};
 items.forEach(item=>{
  const li=renderItem(item);li.classList.add('vanuatu-geography-item');
  const content=el('div');content.className='vanuatu-publication-content';while(li.firstChild)content.append(li.firstChild);li.append(content);
  const link=content.querySelector('.db-item__actions a'),topline=content.querySelector('.db-item__topline');if(link&&topline){content.querySelector('.db-item__badge--doi')?.remove();link.textContent=item.DOI?'DOI':'Link';topline.append(link);}content.querySelector('.db-item__actions')?.remove();
  const geoLabels=[...new Set((item._masterGeographyRows||[]).map(g=>[g.country,g.district,g.specificIsland,g.site].filter(Boolean).join(' · ')).filter(Boolean))];if(geoLabels.length)el('p','Approved study locations: '+geoLabels.join('; '),content).className='vanuatu-approved-locations';
  li.querySelectorAll('.db-item__tags').forEach(n=>{
   const clone=n.cloneNode(true);
   clone.querySelectorAll('.db-item__badge--tag').forEach(chip=>{
    if(chip.dataset.approvedGeography){chip.classList.remove('is-clickable');return;}
    const topics=chip.textContent.split(/\s*,\s*/).map(s=>s.trim()).filter(Boolean);
    chip.replaceWith(...topics.map(topic=>{const pill=el('span',topic);pill.className='db-item__badge db-item__badge--tag';return pill;}));
   });
   n.replaceWith(clone);
  });
  editors.set(item._masterPublicationId,buildGeographyToolbar(li,item,options,dirty,()=>updateCount()));list.append(li);
 });
 if(items.length){updateCount=buildGeographySubmit(main,row,dirty,editors,list);updateCount();}
 document.body.replaceChildren(...[sprites,header,banner,main].filter(Boolean));
}
window.VanuatuScholarPortal={wireShare,openUpdate,renderShared};
})();
