/* Tonga scholar sharing and reviewed submissions. No admin credentials here. */
(function(){
'use strict';
const ENDPOINT='https://script.google.com/macros/s/AKfycbwm6ZOEFya_NOPmMswjxjpqLsoXaYuoH5tMvc2hP29YakWf7dV9728y0iEHmx3WsKGSow/exec';
const DIVISIONS=['Tongatapu',"Ha'apai","Vava'u","'Eua",'Niuas'];
const PACIFIC=['American Samoa','Australia','Cook Islands','Fiji','French Polynesia','Guam','Kiribati','Marshall Islands','Micronesia (Federated States of)','Nauru','New Caledonia','New Zealand','Niue','Northern Mariana Islands','Palau','Papua New Guinea','Pitcairn','Samoa','Solomon Islands','Tokelau','Tuvalu','Vanuatu','Wallis and Futuna'];
let tokenPromise;
function el(tag,text,parent){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(parent)parent.append(n);return n;}
function tokenMap(){if(!tokenPromise)tokenPromise=fetch('data/tongan-share-tokens.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Scholar links are being prepared. Please try again after the next data refresh.');return r.json();}).then(d=>d.m||{}).catch(e=>{tokenPromise=null;throw e;});return tokenPromise;}
async function tokenFor(id){const t=(await tokenMap())[id];if(!/^[0-9a-f]{40}$/.test(t||''))throw new Error('This scholar’s link is not available yet. Please refresh after the next data sync.');return t;}
function profileURL(token){return new URL('s-tonga.html?k='+token,location.href).href;}
async function send(body){const cap=await fetch(ENDPOINT+'?action=submissionCapabilities',{cache:'no-store'}).then(r=>r.json());if(cap.status!=='ok'||cap.country!=='Tonga'||!cap.publicSubmissionsEnabled)throw new Error('Tonga submissions are not open yet. Your entries remain here; please try again once submissions are enabled.');const result=await fetch(ENDPOINT,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)}).then(r=>r.json());if(result.status!=='ok')throw new Error(result.error||result.reason||result.status||'Submission failed');return result;}
function wireShare(card,row){const column=card.querySelector('.db-scholar-card__photo-col');if(!column||!row.scholarId)return;const b=el('button','Share',column);b.type='button';b.className='db-scholar-card__submit tonga-share';b.onclick=async e=>{e.stopPropagation();b.disabled=true;try{const url=profileURL(await tokenFor(row.scholarId));try{await navigator.clipboard.writeText(url);}catch(_){const input=el('textarea',url,document.body);input.select();const ok=document.execCommand('copy');input.remove();if(!ok)throw new Error('Copy unavailable. Open Update info to access the scholar page.');}b.textContent='Copied!';b.classList.add('copied');setTimeout(()=>{b.textContent='Share';b.classList.remove('copied');},1600);}catch(err){b.textContent='Try again';b.title=err.message;alert(err.message);}finally{b.disabled=false;}};}
function input(parent,label,value='',type='text',options){const wrap=el('label',label,parent),n=el(options?'select':type==='textarea'?'textarea':'input',null,wrap);if(options){el('option','',n).value='';options.forEach(v=>{const o=el('option',v,n);o.value=v;});}else if(type!=='textarea')n.type=type;n.value=value==null?'':String(value);return n;}
function section(form,title){const fs=el('fieldset',null,form);el('legend',title,fs);return fs;}
function dialog(title){const d=el('dialog',null,document.body);d.className='tonga-form';const heading=el('h2',title,d);heading.id='tonga-update-title';heading.tabIndex=-1;d.setAttribute('aria-labelledby',heading.id);d.addEventListener('close',()=>d.remove());const form=el('form',null,d);form.method='dialog';const status=el('p','',d);status.setAttribute('role','status');d.showModal();heading.focus();return{d,form,status};}
function identity(form){const fs=section(form,'Who is submitting');const name=input(fs,'Your name'),email=input(fs,'Your email','','email'),relationship=input(fs,'Relationship to this scholar','','text',['Self','Family','Friend','Student','Colleague','Other']);[name,email,relationship].forEach(n=>n.required=true);return()=>({submitterName:name.value.trim(),submitterEmail:email.value.trim(),submitterRelationship:relationship.value});}
function base(row,token){return{scholarId:row.scholarId,scholarName:row.name,shareToken:token,profileUrl:profileURL(token)};}
function clean(v){return /^(unknown|unclassified|n\/a)$/i.test(String(v||'').trim())?'':String(v||'');}
async function openUpdate(row,state){
 const profile=(state.scholarProfilesByName&&state.scholarProfilesByName.get(row.name))||row;
 const sid=row.scholarId||profile.scholarId;row=Object.assign({},profile,row,{scholarId:sid});
 let token;try{token=await tokenFor(sid);}catch(e){alert(e.message);return;}
 const {d,form,status}=dialog('Update info for this scholar');
 el('p','Correcting / adding info for '+row.name+'. Fields below are pre-filled with the information the public dashboard is currently showing. Edit only what you want to add, remove or correct.',form).className='tonga-form-subtitle';
 const notice=el('div',null,form);notice.className='tonga-review-notice';el('strong','Please read: ',notice);notice.append(document.createTextNode('corrections are reviewed by the Vave Lab team before the public profile is updated, so changes will not appear immediately. Ideally, edits should be submitted by the scholar themselves — friends, family, students and colleagues can also submit on their behalf.'));
 const who=identity(form),fields=[],files=[];
 const identitySet=form.querySelector('fieldset');identitySet.querySelector('legend').textContent='Who is submitting this';
 identitySet.querySelectorAll('input,select').forEach(n=>{const mark=el('span',' *');mark.className='tonga-required';n.parentElement.insertBefore(mark,n);});
 const relationship=identitySet.querySelector('select');relationship.parentElement.classList.add('wide');relationship.options[0].textContent='Select one…';
 function add(fs,key,label,value,options,type){const n=input(fs,label,clean(value),type||'text',options),initial=n.value;n.name=key;fields.push({key,n,initial});if(options)n.options[0].textContent='(select)';if(type==='url')n.placeholder='https://…';return n;}
 function wide(n){n.parentElement.classList.add('wide');return n;}
 function hint(n,text){el('small',text,n.parentElement);return n;}
 function upload(fs,key,label,accept,text,full=false){const n=input(fs,label,'','file');n.name=key;n.accept=accept;files.push({key,n});if(full)wide(n);if(text)hint(n,text);return n;}
 for(const side of ['paternal','maternal']){
  const publicSide=side==='paternal',prefix=publicSide?'Paternal':'Maternal',fs=section(form,prefix+' geography');fs.className='tonga-geography-'+side;
  if(!publicSide){const help=el('p','Optional. Maternal information is for internal research/database purposes and will not be displayed on the public dashboard or scholar profile.',fs);help.className='wide tonga-field-help';}
  add(fs,side+'_island_division',prefix+' Island Division',publicSide?(profile.paternalIslandDivision==='Ongo Niua'?'Niuas':profile.paternalIslandDivision):'',DIVISIONS);
  add(fs,side+'_island',prefix+' Specific Island',publicSide?profile.paternalIsland:'');
  add(fs,side+'_district',prefix+' District',publicSide?profile.paternalDistrictName:'');
  add(fs,side+'_village',prefix+' Village / Town (Kolo)',publicSide?profile.paternalVillage:'');
 }
 const fs=section(form,'Scholar profile');
 add(fs,'salutation','Salutation',profile.salutation,['Dr','Prof','Rev','Rev Dr','Mr','Mrs','Ms']);
 add(fs,'title','Professional title',profile.title);
 wide(add(fs,'institution','Institution',profile.institution));
 add(fs,'institution_url','Institution URL',profile.institutionUrl,null,'url');
 add(fs,'department','Department',profile.department);
 add(fs,'department_url','Department URL',profile.departmentUrl,null,'url');
 add(fs,'profile_url','Faculty profile URL',profile.profileUrl,null,'url');
 add(fs,'google_scholar_url','Google Scholar URL',profile.googleScholarUrl,null,'url');
 add(fs,'orcid_url','ORCID iD URL',profile.orcidUrl,null,'url');
 upload(fs,'headshot','High-resolution headshot (JPEG)','.jpg,.jpeg,image/jpeg','Please upload a clear, high-resolution headshot as a JPEG (.jpg or .jpeg).',true);
 const gender=add(fs,'gender','Gender',profile.gender,['Tangata','Fefine','Unknown']);[...gender.options].forEach(o=>{if(o.value==='Tangata')o.textContent='Tangata (Male)';if(o.value==='Fefine')o.textContent='Fefine (Female)';});
 for(const [level,title] of [['masters','Masters'],['phd','PhD']]){
  const f=section(form,title),rows=(state.master.gradDegrees||state.master.grad||[]),matches=rows.filter(g=>g['Scholar ID']===sid&&(level==='masters'?/master/i:/phd|doctor/i).test(g['Degree Stage']||'')),g=matches.length===1?matches[0]:{};
  add(f,level+'_university',title+' — University',profile[level+'University']);
  add(f,level+'_country',title+' — Country',profile[level+'Country']);
  add(f,level+'_year',title+' — Year completed',g['Finish / Completion Year']);
  hint(add(f,level+'_thesis_url','Link to '+title+' thesis / degree',g['Thesis / Repository URL'],null,'url'),'Provide a direct university/repository link where possible.');
  upload(f,level+'_thesis','Upload '+title+' thesis PDF','.pdf,application/pdf','Optional PDF. The uploaded filename includes the Scholar ID.');
 }
 const cv=section(form,'CV (optional)');upload(cv,'cv','Upload your latest CV (PDF)','.pdf,application/pdf','Your CV is for internal review only and will not be shared further or displayed on the public dashboard.',true);
 const pubs=section(form,'Publications to add');upload(pubs,'publications','BibTeX or EndNote file','.bib,.ris,.enw','Attach one file containing all the publications you want added. BibTeX (.bib) is preferred; an EndNote export (.enw or .ris) is also fine.',true);
 const notes=wide(input(pubs,'Anything else we should know?','','textarea'));notes.rows=3;notes.placeholder='Optional — e.g. context on which fields you edited, or corrections that don’t fit above.';
 el('p','Attachments: up to 12 MB per file and 30 MB total.',form).className='tonga-field-help';
 const actions=el('div',null,form);actions.className='tonga-form-actions';const cancel=el('button','Cancel',actions);cancel.type='button';cancel.className='tonga-form-cancel';cancel.onclick=()=>d.close();const button=el('button','Submit for review',actions);button.type='submit';
 form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;button.disabled=true;status.textContent='Submitting…';try{const changed={};fields.forEach(f=>{if(f.n.value!==f.initial)changed[f.key]=f.n.value.trim();});const selected=files.filter(f=>f.n.files.length);let total=0;const attachments=[];for(const f of selected){const file=f.n.files[0];total+=file.size;if(file.size>12*1024*1024||total>30*1024*1024)throw new Error('Attachments exceed the size limit.');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});attachments.push({field:f.key,name:sid+'-'+file.name,type:file.type||'application/octet-stream',data});}if(!Object.keys(changed).length&&!attachments.length)throw new Error('Change at least one field or attach a file.');const result=await send(Object.assign(base(row,token),who(),{action:'submitScholarProfileUpdate',fields:changed,structuredSubmission:{changedFieldsOnly:true,notes:notes.value.trim()},files:attachments}));status.textContent='Submitted for review. Reference: '+result.submissionId+'. Your public profile will change only after approval and the next data refresh.';button.remove();form.querySelectorAll('input,select,textarea').forEach(n=>n.disabled=true);}catch(err){status.textContent=err.message;button.disabled=false;}};
}
// Keep island divisions distinct from specific islands in the Master payload.
function geoName(value){return String(value||'').trim().replace(/[ʻ’‘ʼ]/g,"'");}
function divisionName(value){const v=geoName(value);return v==='Ongo Niua'?'Niuas':DIVISIONS.includes(v)?v:'';}
function islandName(value){return geoName(value).replace(/\s*\([^)]*\)\s*$/,'').trim();}
function tongaOptions(state){
 const options=[{value:'national',label:'Tonga — general / national study',location:{national:true}}];
 // The approved Master geography supplies specific islands, without guessing
 // an island's division from scholar ancestry or publication titles.
 for(const division of DIVISIONS){
  options.push({value:'division:'+division,label:division==='Niuas'?'Niuas (Ongo Niua)':division,location:{division},group:true});
  const islands=new Set((state.master.geography||[]).filter(g=>g.Country==='Tonga'&&divisionName(g['Island Division (auto from District)'])===division).map(g=>islandName(g['Specific Island'])).filter(Boolean));
  [...islands].sort((a,b)=>a.localeCompare(b)).forEach(island=>options.push({value:'island:'+division+':'+island,label:island===division?island+' (main island)':island,location:{division,island},island:true}));
 }
 return options;
}
function checkMenu(parent,label,options,selected,onChange){
 const details=el('details',null,parent);details.className='tonga-geo-menu';
 const summary=el('summary',null,details);el('span',label,summary);const count=el('span','',summary);count.className='tonga-geo-count';el('span','▾',summary).setAttribute('aria-hidden','true');
 const panel=el('div',null,details);panel.className='tonga-geo-options';
 const checks=options.map(opt=>{const lab=el('label',null,panel);lab.className=opt.island?'tonga-geo-island':opt.group?'tonga-geo-group':'';const cb=el('input',null,lab);cb.type='checkbox';cb.value=opt.value;cb.checked=selected.has(opt.value);cb.disabled=cb.checked;el('span',opt.label,lab);if(cb.checked)lab.title='Already approved; existing locations are preserved.';cb.onchange=()=>{sync();onChange();};return cb;});
 function sync(){const n=checks.filter(c=>c.checked).length;count.textContent=n?String(n):'';count.hidden=!n;}
 details.addEventListener('toggle',()=>{if(details.open)document.querySelectorAll('.tonga-geo-menu[open]').forEach(n=>{if(n!==details)n.open=false;});});
 sync();return{details,checks,values:()=>checks.filter(c=>c.checked&&!c.disabled).map(c=>c.value)};
}
function buildGeographyToolbar(li,item,options,dirty,updateCount){
 const toolbar=el('div',null,li);toolbar.className='tonga-geo-toolbar';toolbar.setAttribute('aria-label','Study locations for '+item.title);
 const approved=item._masterGeographyRows||[],selected=new Set();
 for(const g of approved){if(g.Country!=='Tonga')continue;const division=divisionName(g['Island Division (auto from District)']),island=islandName(g['Specific Island']);if(island&&division)selected.add('island:'+division+':'+island);else if(division&&!g.District&&!g['Village / Town / Site'])selected.add('division:'+division);else if(!division&&!island&&!g.District&&/national|general/i.test(g['Geography Type']||''))selected.add('national');}
 const national=checkMenu(toolbar,'Tonga',options,selected,changed);
 const pacific=checkMenu(toolbar,'Pacific Island country',PACIFIC.map(c=>({value:c,label:c})),new Set(approved.map(g=>g.Country)),changed);
 const other=el('input',null,toolbar);other.type='text';other.className='tonga-geo-other';other.placeholder='Other countries';other.setAttribute('aria-label','Other countries; separate names with semicolons');other.title='Separate country names with semicolons, for example Jamaica; China';other.oninput=changed;
 const status=el('p','',toolbar);status.className='tonga-geo-item-status';status.setAttribute('role','status');
 function changed(){
  const loc=national.values().map(v=>options.find(o=>o.value===v).location),pac=pacific.values();
  const existingCountries=new Set(approved.filter(g=>g.Country!=='Tonga'&&!PACIFIC.includes(g.Country)).map(g=>String(g.Country).toLowerCase()));
  const countries=other.value.split(';').map(c=>c.trim()).filter(Boolean).filter((c,i,a)=>a.findIndex(v=>v.toLowerCase()===c.toLowerCase())===i&&!existingCountries.has(c.toLowerCase()));
  if(loc.length||pac.length||countries.length){dirty.set(item._masterPublicationId,{item_key:item._masterPublicationId,title:item.title,year:item.year,tonga_locations:loc,pacific_countries:pac,other_countries:countries});status.textContent='Selections ready to submit below.';}else{dirty.delete(item._masterPublicationId);status.textContent='';}updateCount();
 }
 return{submitted(){[...national.checks,...pacific.checks].forEach(cb=>{if(cb.checked)cb.disabled=true;});other.value='';status.textContent='Submitted for review.';},toolbar};
}
function buildGeographySubmit(main,row,token,dirty,editors,list){
 const form=el('form',null,main);form.className='tonga-geo-submit';el('h3','Submit publication geography for review',form);el('p','Select locations beside the publications above, then submit them together. Approved locations are preserved; new suggestions appear publicly only after review and a data refresh.',form);const who=identity(form);
 const button=el('button','Submit geography for review',form);button.type='submit';const count=el('span','0 publications changed',form);count.className='tonga-geo-dirty-count';const status=el('p','',form);status.setAttribute('role','status');
 function updateCount(){count.textContent=dirty.size+' publication'+(dirty.size===1?'':'s')+' changed';}
 form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;if(!dirty.size){status.textContent='Select or enter at least one new study location above.';return;}
  const changes=[...dirty.values()];if(changes.some(c=>c.tonga_locations.length>30)){status.textContent='Please select no more than 30 Tonga locations per publication.';return;}
  const controls=[...list.querySelectorAll('input'),...form.querySelectorAll('input,select,button')],disabled=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);let completed=0;status.textContent='Submitting…';
  try{for(let i=0;i<changes.length;i+=100){const batch=changes.slice(i,i+100);await send(Object.assign(base(row,token),who(),{action:'submitPublicationGeography',changes:batch}));batch.forEach(c=>dirty.delete(c.item_key));completed+=batch.length;updateCount();}status.textContent=completed+' publication'+(completed===1?'':'s')+' submitted to the Tonga Admin panel for review. Thank you.';}
  catch(err){status.textContent=(completed?completed+' publications submitted. Remaining selections are retained. ':'')+err.message;}
  finally{controls.forEach((n,i)=>n.disabled=disabled[i]);changes.filter(c=>!dirty.has(c.item_key)).forEach(c=>editors.get(c.item_key).submitted());}
 };return updateCount;
}
document.addEventListener('click',e=>{document.querySelectorAll('.tonga-geo-menu[open]').forEach(n=>{if(!n.contains(e.target))n.open=false;});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const menus=document.querySelectorAll('.tonga-geo-menu[open]');if(menus.length){e.preventDefault();menus.forEach(n=>{n.open=false;n.querySelector('summary').focus();});}}});
async function renderShared(state,renderCard,renderItem){
 const {scholarId,token}=window.__tongaSharedScholar,profile=Array.from(state.scholarProfilesByName.values()).find(p=>p.scholarId===scholarId);if(!profile)throw new Error('Scholar not found in the current snapshot.');
 const counts=state.masterAdapter.computePublicationTotals(state.master,scholarId,{excludePreprints:true,excludeDocuments:true}),row=Object.assign({},profile,{total:counts.total,firstAuthored:counts.firstAuthored,types:counts.types,_authorshipGap:counts.gap});
 const main=el('main');main.className='tonga-portal';
 const banner=document.querySelector('.page-banner')?.cloneNode(true);
 const logo=document.querySelector('.nav-logo')?.cloneNode(true);
 const header=el('header');header.className='tonga-profile-header';if(logo)header.append(logo);
 const sprites=document.querySelector('svg:has(symbol)')?.cloneNode(true);
 const intro=el('section',null,main);intro.className='tonga-portal-intro';
 intro.innerHTML=`
 <div class="direct-review-badge">PRE-LAUNCH PROFILE REVIEW</div>
 <p><strong>About this database.</strong> The Tongan Scholarly Research Database is an evolving resource highlighting the scholarship and contributions of Tongan and part-Tongan postgraduates and researchers in Tonga and around the world. The project is led and curated by <a href="https://ronvave.github.io/vave-lab/" target="_blank" rel="noopener">Dr. Ron Vave</a>, an <em>iTaukei</em> scholar and Assistant Professor at the University of Hawaiʻi at Mānoa, in collaboration with <a href="https://about.byuh.edu/directory/tevita-kaili" target="_blank" rel="noopener">Professor Tevita Kaili</a> and <a href="https://about.byuh.edu/directory/inoke-hafoka" target="_blank" rel="noopener">Associate Professor Inoke Hafoka</a> of Brigham Young University–Hawaii. It is part of a regional scholarly database initiative that Dr. Vave is spearheading through UH Mānoa’s <a href="https://hawaii.edu/cpis/" target="_blank" rel="noopener">Center for Pacific Islands Studies</a>, and a sister project to the iTaukei Scholarly Research Database. This initiative is being developed across Pacific Island countries to support the visibility, networking, collaboration and mentorship of Indigenous students and researchers, while making our scholarship more accessible to wider audiences. As an ongoing passion project, this database is not comprehensive and is slowly being added to. <strong>The database and dashboard remain under development and have not yet been publicly launched.</strong></p>
 <p><strong>Why you have been sent this link.</strong> You have been sent a direct link to this scholar profile so the information can be checked and improved.</p>
 <p class="direct-review-callout"><strong>If this is your scholar profile, please scroll down to see your Scholar Profile card, click on Update info to add, remove or change details.</strong></p>
 <p>You can provide missing paternal geography, current professional information, graduate-study details and publication information. You can also attach your latest <strong>CV</strong>, upload a <strong>high-resolution JPEG headshot</strong>, and provide either a direct link to or a PDF copy of your Master’s and/or PhD thesis. <strong>Your CV will only be used to extract relevant information for this database, such as publications, awards, positions and related scholarly information. It will not be shared further and will not be displayed on the scholar dashboard.</strong></p>
 <p><strong>Maternal information is optional.</strong> If you choose to provide it, it will be used only for internal research/database purposes and <strong>will not be displayed on the public dashboard or scholar profile.</strong></p>
 <p>All submissions are reviewed before changes appear. After public launch, this permanent profile link can also be shared by the scholar, recruiters, collaborators, students and others who want a direct view of the scholar’s profile.</p>`;
 el('h2','Current database totals',main).className='tonga-summary-heading';
 for(const selector of ['.db-section--overview','.db-section--itaukei']){const panel=document.querySelector(selector)?.cloneNode(true);if(panel){panel.classList.add('tonga-summary');main.append(panel);}}
 const source=document.querySelector('[data-panel="B2"]');
 if(source){const summary=el('section',null,main);summary.className='db-section tonga-summary';el('h2','TONGAN GRADUATES — GLOBAL DATABASE',summary).className='db-section__label';const value=k=>source.querySelector('[data-b2-kpi="'+k+'"]')?.textContent||'0';el('p',`The database currently records ${value('theses')} Master’s and PhD theses completed by ${value('scholars')} Tongan scholars across ${value('unis')} universities in ${value('countries')} countries, comprising ${value('masters')} Master’s theses and ${value('phd')} PhD theses.`,summary).className='db-section__hint';const tiles=source.querySelector('[data-b2-kpis]');if(tiles)summary.append(tiles.cloneNode(true));}
 const card=renderCard(row);main.append(card);card.title='Scholar profile';
 const ids=new Set((state.master.authorship||[]).filter(a=>a['Scholar ID']===scholarId).map(a=>a['Publication ID / BibTeX Key']));const items=state.snapshot.items.filter(it=>ids.has(it._masterPublicationId));
 const pubHead=el('section',null,main);pubHead.className='tonga-portal-intro tonga-publications-head';el('h2','Publications currently linked to this scholar',pubHead);
 el('p',items.length+' publications are shown below using the same records, publication-type colors and working DOI/source links as the main dashboard.',pubHead);
 const guidance=el('p',null,pubHead);guidance.innerHTML='<strong class="scholar-geotag-highlight">Please help us geotag your research.</strong> For each thesis, book, book chapter, journal article or report, use the <strong>Tonga</strong> dropdown to select the islands or island groups where the study was undertaken. Specific islands are listed beneath their island group. Use <strong>Tonga — general / national study</strong> where the work concerns Tonga broadly and is not tied to a particular locality. Where relevant, identify another Pacific Island country or territory. For research outside the Pacific, use <strong>Other countries</strong> and enter country names separated by semicolons (for example, <strong>Jamaica; China</strong>). You can select multiple locations for each publication, then use <strong>Submit geography for review</strong> below the publication list.';
 el('p','Geotagging allows publications to appear when the database is filtered by study location. This helps government agencies, Non-Government Organizations (NGOs), Civil Society Organizations (CSOs), and local communities find research undertaken in their island division or district and draw on it in planning and decision making. Geographic suggestions are reviewed before they are added to the database. Existing approved study locations are shown with each publication and are preserved when you suggest additional locations.',pubHead);
 const list=el('ul',null,main);list.className='db-items tonga-geography-list';
 const dirty=new Map(),editors=new Map(),options=tongaOptions(state);let updateCount=()=>{};
 items.forEach(item=>{
  const li=renderItem(item);li.classList.add('tonga-geography-item');
  const content=el('div');content.className='tonga-publication-content';while(li.firstChild)content.append(li.firstChild);li.append(content);
  const link=content.querySelector('.db-item__actions a'),topline=content.querySelector('.db-item__topline');if(link&&topline){content.querySelector('.db-item__badge--doi')?.remove();link.textContent=item.DOI?'DOI':'Link';topline.append(link);}content.querySelector('.db-item__actions')?.remove();
  const geoLabels=[...new Set((item._masterGeographyRows||[]).map(g=>[g.Country,g['Island Division (auto from District)'],g.District,g['Specific Island'],g['Village / Town / Site']].filter(Boolean).join(' · ')).filter(Boolean))];if(geoLabels.length)el('p','Approved study locations: '+geoLabels.join('; '),content).className='tonga-approved-locations';
  li.querySelectorAll('.db-item__tags').forEach(n=>{const clone=n.cloneNode(true);n.replaceWith(clone);});
  editors.set(item._masterPublicationId,buildGeographyToolbar(li,item,options,dirty,()=>updateCount()));list.append(li);
 });
 if(items.length)updateCount=buildGeographySubmit(main,row,token,dirty,editors,list);
 document.body.replaceChildren(...[sprites,header,banner,main].filter(Boolean));
}
window.TongaScholarPortal={wireShare,openUpdate,renderShared};
})();
