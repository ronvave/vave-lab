/* Translate only explicitly linked Vanuatu Master records into the reference
 * renderer's schema. IDs, evidence and independent geography are preserved. */
(function(w){
'use strict';
let bundle=null,password='',native=null;
const str=v=>String(v??'').trim(),G=w.VanuatuGeography,M=w.VanuatuModel;
const aliases={Salutation:'Title / Salutation','Vital Status':'Alive / Deceased','Paternal Province':'Paternal Island Division','Maternal Province':'Maternal Island Division','Paternal Island':'Specific Island Paternal','Maternal Island':'Specific Island Maternal','Paternal Village / Community':'Village/Town Paternal (Kolo)','Maternal Village / Community':'Village/Town Maternal (Kolo)','ORCID / Researcher ID':'ORCID URL','Degree Level':'Degree Stage','Degree Name':'Degree / Qualification','Canonical University Name (C_Uni)':'C_Uni name','Original University Name (O_Uni)':'O_Uni name','University Country':'Country','Completion Year':'Finish / Completion Year','Thesis / Dissertation Title':'Thesis / Research Title','Thesis URL / Handle':'Thesis / Repository URL','Publication ID':'Publication ID / BibTeX Key','Lead / First Author?':'Is First Author?'};
function adapt(r){const a={...r};for(const [k,v] of Object.entries(aliases))if(k in r)a[v]=r[k];return a;}
function rows(name){const t=bundle?.tables||{},out=(t[name]||[]).map(adapt);
 if(name==='Scholars')out.forEach(s=>{s['District Paternal']=s['Paternal Province']||'';s['District Maternal']=s['Maternal Province']||'';s['Island Division']=s['Paternal Province']||'';s._vanuatuCountEligible=true;});
 if(name==='Graduate Degrees')out.forEach(d=>{d['Scholar Name']=t.Scholars?.find(s=>s['Scholar ID']===d['Scholar ID'])?.['Scholar Name']||'';d['Year / Status']=d['Completion Year']||d['Completion Status']||'';});
 if(name==='Research Geography')out.forEach(g=>{g.District=g.Province||'';g['Island Division']=g.Province||'';g['Specific Island']=g.Island||'';g['Research Site']=g['Area Council / Locality']||g['Research Site / Locality']||'';});
 return out;
}
async function decrypt(bytes,pw){const a=new Uint8Array(bytes);if(new TextDecoder().decode(a.slice(0,4))!=='IVAV')throw Error('Unsupported Vanuatu snapshot format.');const seed=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:a.slice(4,20),iterations:200000,hash:'SHA-256'},seed,{name:'AES-GCM',length:256},false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:a.slice(20,32)},key,a.slice(32))));}
function use(next){M.build(next);bundle=next;return next;}
async function load(pw){const r=await fetch(w.VANUATU_CONFIG.snapshot,{cache:'no-store'});if(!r.ok)throw Error(r.status===404?'Vanuatu data is not connected yet. Preview the dashboard layout below.':'Vanuatu snapshot could not load ('+r.status+').');let data;try{data=await decrypt(await r.arrayBuffer(),pw);}catch{throw Error('Unable to unlock the Vanuatu data. Check the Vanuatu password.');}use(data);password=pw;return data;}
function inherit(){try{if(w.parent!==w&&w.parent.location.origin===location.origin&&w.parent.VanuatuBundle?.current())use(w.parent.VanuatuBundle.current());}catch{}}
function preview(){password='';return use(w.VANUATU_PREVIEW);}
function rpc(name,payload){return new Promise((resolve,reject)=>{if(!w.google?.script?.run)return reject(Error('Open the Vanuatu Admin deployment to edit the Master file.'));w.google.script.run.withSuccessHandler(resolve).withFailureHandler(e=>reject(Error(e.message||'Vanuatu Admin request failed.')))[name](payload);});}
async function nativeState(){native=await rpc('getVanuatuAdminState');use({country:'Vanuatu',schemaVersion:1,generation:'native-admin',tables:native.tables,fields:Object.fromEntries(Object.entries(native.tables).map(([k,r])=>[k,[...new Set(r.flatMap(x=>Object.keys(x)))]])),enrichment:native.enrichment||{}});return native;}
async function fetchJson(path){inherit();path=path.split('?')[0];if(path==='data/vanuatu-provinces.geojson'){const r=await fetch(path);if(!r.ok)throw Error('Vanuatu province boundaries unavailable.');const geo=await r.json();geo.features.forEach(f=>{f.properties.name=G.province(f.properties.shapeName);f.properties.confederacy=f.properties.name;f.properties.islandDivision=f.properties.name;});return geo;}
 if(!bundle)throw Error('Unlock the Vanuatu data first.');
 const map={'scholars':'Scholars','publications':'Publications','authorship':'Authorship','grad-degrees':'Graduate Degrees','geography':'Research Geography'};const suffix=path.replace(/^data\/vanuatu-master-/,'').replace(/\.json$/,'');if(map[suffix])return rows(map[suffix]);
 if(/master-mobility/.test(path))return M.mobility(M.build(bundle)).rows;
 if(/last-master-sync/.test(path))return {finishedAt:bundle.generatedAt||null,preview:!!bundle.preview};
 if(/master-aggregates/.test(path)){
  if(!w.VanuatuDashboardModel)return {};
  const model=M.build(bundle),data=w.VanuatuDashboardModel.disciplines(model),sizes=r=>Object.fromEntries(['male','female','masters','phd','total'].map(k=>[k,r[k].size]));
  return {shortDisciplines:{rows:data.rows.map(r=>({discipline:r.name,...sizes(r)})),overall:sizes(data.all),allCompleted:new Set(model.completed.map(r=>r['Scholar ID'])).size,allMasters:new Set(model.completed.filter(r=>M.level(r)==='masters').map(r=>r['Scholar ID'])).size,generatedAt:bundle.generatedAt||null}};
 }

 if(/scholar-enrichment/.test(path))return {version:1,scholars:bundle.enrichment||{}};
 if(/scholar-insights-master/.test(path)){const out={};for(const [id,e] of Object.entries(bundle.enrichment||{}))if(e.summary||e.insights)out[id]=e.insights||{keywords:e.keywords||[],sources:e.sources||[],summaryHtml:e.summary||'',summaryFormat:'plain'};return {version:1,scholars:out};}
 if(/body-composition/.test(path)){
  const out={Woman:{scholars:0,masters:0,phd:0,journal:0,book:0,bookSection:0,report:0},Man:{scholars:0,masters:0,phd:0,journal:0,book:0,bookSection:0,report:0}},gender=new Map();
  for(const s of bundle.tables.Scholars||[]){const k=s.Gender==='Female'?'Woman':s.Gender==='Male'?'Man':null;if(k){out[k].scholars++;gender.set(s['Scholar ID'],k);}}
  for(const d of bundle.tables['Graduate Degrees']||[]){const k=gender.get(d['Scholar ID']);if(k&&/^completed$/i.test(d['Completion Status']||'')){if(/master/i.test(d['Degree Level']||''))out[k].masters++;else if(/phd|doctor/i.test(d['Degree Level']||''))out[k].phd++;}}
  const codes={'Journal Article':'journal','Book':'book','Book Chapter':'bookSection','Report':'report',"Master's Thesis":'masters','PhD Thesis':'phd'};
  for(const p of bundle.tables.Publications||[]){const leads=(bundle.tables.Authorship||[]).filter(a=>a['Publication ID']===p['Publication ID']&&(Number(a['Author Position'])===1||a['Lead / First Author?']===true));const k=leads.length===1?gender.get(leads[0]['Scholar ID']):null,t=codes[p['Publication Type']];if(k&&t&&!['masters','phd'].includes(t))out[k][t]++;}
  return out;
 }

 if(/researcher-authorship|geography-coordinates/.test(path))return [];
 if(/worldpoints/.test(path))return null;
 if(/\.json$/.test(path)&&/^data\/vanuatu-/.test(path)&&password){const r=await fetch(path+'.enc',{cache:'no-store'});if(r.ok)return decrypt(await r.arrayBuffer(),password);}
 throw Error('Vanuatu resource is not available: '+path);
}
w.VanuatuBundle={load,use,preview,clear:()=>{bundle=null;password='';native=null;},current:()=>bundle,isPreview:()=>!!bundle?.preview,rows,adapt,rpc,nativeState,native:()=>native,fetchJson};
w.VanuatuAdapter=w.VanuatuBundle;
})(window);
