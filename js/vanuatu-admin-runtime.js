/* Retain the reference owner Admin layout, with authenticated Vanuatu writes. */
(function(w){'use strict';const B=w.VanuatuBundle,G=w.VanuatuGeography;
const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
const preview=()=>{B.preview();w.dispatchEvent(new Event('vanuatu:admin-unlocked'));};
function councils(side){const sel=document.getElementById('me-clan-'+side),prov=document.getElementById('me-div-'+side+'-derived').value;if(sel&&sel.dataset.province!==prov){const value=sel.dataset.loaded||sel.value;sel.dataset.province=prov;sel.replaceChildren(new Option('(unset)',''),...(G.councils[prov]||[]).map(c=>new Option(c,c)));if(value&&!Array.from(sel.options).some(o=>o.value===value))sel.add(new Option(value+' (recorded)',value));sel.value=value;}}
function protect(){const modal=document.getElementById('edit-modal');if(!modal?.classList.contains('is-visible'))return;
 document.getElementById('pf-photo-drop').textContent='Use an approved HTTPS photo URL above.';
 const readonly=B.isPreview()||B.native()?.role!=='owner',save=document.getElementById('modal-save');save.disabled=readonly;save.textContent=readonly?(B.isPreview()?'Read-only preview':'Open owner deployment to save'):'Save & push';
 for(const side of ['paternal','maternal'])councils(side);
}
async function queues(){for(const [name,id] of [['Scholar Profile Submissions','tab-scholar-submissions'],['Publication Geography Submissions','tab-geography-submissions'],['Review Queue','tab-review-queue']]){
 const card=document.querySelector('#'+id+' .card');if(!card)continue;card.querySelector('[data-vanuatu-queue-content]')?.remove();const out=el('div');out.dataset.vanuatuQueueContent='';card.append(out);
 if(B.isPreview()||!B.native()){out.textContent=B.isPreview()?'Read-only preview: no real submissions are loaded.':'Open the authenticated Vanuatu owner deployment to review submissions.';continue;}
 const rows=B.current()?.tables[name]||[];if(!rows.length){out.textContent='No Vanuatu records in this queue.';continue;}
 for(const r of rows){const section=el('section');section.className='fieldset';section.append(el('h3',(r['Submission ID']||r['Candidate ID'])+' · '+(r['Scholar Name']||r['Scholar ID']||r.Author||'')+' · '+(r.Status||'Unresolved')));const details=el('dl');for(const [k,v] of Object.entries(r))if(k!=='_version'&&v){details.append(el('dt',k),el('dd',String(v)));}section.append(details);
 if(r.Status==='Pending'){
  let changes={};try{changes=JSON.parse(r['Changed Fields JSON']||'{}');}catch{}
  const checks=[];if(name==='Scholar Profile Submissions')for(const [field,value] of Object.entries(changes)){const label=el('label'),input=el('input');input.type='checkbox';input.value=field;checks.push(input);label.append(input,document.createTextNode(' '+field+': '+String(value?.current??'')+' → '+String(value?.proposed??'')));section.append(label,el('br'));}
  const notes=el('textarea');notes.placeholder='Review evidence / reason';notes.setAttribute('aria-label','Review evidence / reason');section.append(notes);
  const status=el('p');status.setAttribute('role','status');
  for(const [action,label] of (name==='Scholar Profile Submissions'?[['approve','Approve selected fields'],['reject','Reject proposal']]:[['reject','Reject proposal']])){const button=el('button',label);button.className='btn';button.onclick=async()=>{const fields=checks.filter(c=>c.checked).map(c=>c.value);if(!notes.value.trim()){status.textContent='Record the review evidence or reason first.';return;}if(action==='approve'&&!fields.length){status.textContent='Select the fields to approve.';return;}if(!confirm(label+' for '+(r['Submission ID']||r['Candidate ID'])+'?'))return;button.disabled=true;try{const result=await B.rpc('reviewVanuatuProposal',{table:name,id:r['Submission ID']||r['Candidate ID'],expectedVersion:r._version,action,fields,notes:notes.value.trim(),operationId:crypto.randomUUID()});await B.nativeState();await queues();status.textContent=result.message;}catch(e){status.textContent=e.message;button.disabled=false;}};section.append(button);}
  if(name!=='Scholar Profile Submissions')section.append(el('p','Approval requires owner evidence review in the Vanuatu Master.'));
  section.append(status);
 }
 out.append(section);
 }
}}
function blockLegacy(){for(const id of ['refresh-master','top-force-refresh','force-cache-bust','force-refresh','migration-write-btn','gh-token','save-gh-token','clear-gh-token','pf-photo-file','writeback-endpoint','writeback-secret','writeback-save','writeback-test','writeback-clear']){const n=document.getElementById(id);if(n){n.disabled=true;n.title='Use the configured Vanuatu owner deployment and publication workflow.';}}
 // Capture guards also cover controls the reference controller may re-enable.
 document.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&/^(refresh-master|top-force-refresh|force-cache-bust|force-refresh|migration-write-btn|save-gh-token|clear-gh-token|writeback-save|writeback-test|writeback-clear)$/.test(b.id)){e.preventDefault();e.stopImmediatePropagation();}},true);
}
document.addEventListener('DOMContentLoaded',()=>{document.getElementById('admin-preview').onclick=preview;new MutationObserver(protect).observe(document.getElementById('edit-modal'),{attributes:true,attributeFilter:['class']});for(const side of ['paternal','maternal'])document.getElementById('me-div-'+side+'-derived').addEventListener('change',()=>councils(side));document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',queues));blockLegacy();const url=w.VANUATU_CONFIG.adminURL;if(/^https:\/\/script\.google\.com\/macros\/s\//.test(url)){const a=el('a','Open Vanuatu owner Admin');a.href=url;document.getElementById('native-admin-link').append(a);}
 if(w.google?.script?.run)B.nativeState().then(()=>w.dispatchEvent(new Event('vanuatu:admin-unlocked'))).catch(e=>{document.getElementById('login-error').textContent=e.message;document.getElementById('login-error').classList.add('is-visible');});else if(new URLSearchParams(location.search).get('preview')==='1')preview();
});w.addEventListener('vanuatu:admin-unlocked',()=>{if(B.isPreview()&&!document.getElementById('vanuatu-admin-preview-notice')){const n=el('p','FICTIONAL LAYOUT PREVIEW — example records only; all writes are disabled.');n.id='vanuatu-admin-preview-notice';n.className='count-summary';document.querySelector('main.wrap').prepend(n);}queues();});
})(window);
