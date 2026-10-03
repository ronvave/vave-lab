/* Preserve the reference Admin's preview/read/write interface while routing
 * only to the authenticated Vanuatu service and stable Vanuatu entity IDs. */
(function(w){'use strict';const B=w.VanuatuBundle;let endpoint='';
const rowKeys=new Map();
const keys={Scholars:'Scholar ID',Positions:'Position ID','Graduate Degrees':'Degree ID'};
const all=table=>B.current()?.tables[table]||[];
const configured=()=>!!B.native()||B.isPreview();
const requireOwner=()=>{if(B.isPreview()||B.native()?.role!=='owner')throw Error('An authorized Vanuatu owner account is required to save changes.');};
async function refresh(){if(B.isPreview())return;await B.nativeState();}
function find(c){const table=c.worksheet;if(!keys[table])throw Error('Unsupported Vanuatu table.');const r=table==='Scholars'?all(table).find(r=>r['Scholar ID']===c.scholarId):all(table).find(r=>r[keys[table]]===rowKeys.get(table+':'+c.scholarId+':'+c.rowNumber));if(!r||r['Scholar ID']!==c.scholarId)throw Error('Record is missing or changed. Reload before editing.');return r;}
async function write(changes,opts={}){requireOwner();await refresh();const results=changes.map(c=>{try{const r=find(c),currentValue=String(r[c.field]??''),intendedValue=String(c.newValue??''),sensitive=/Status|Approved|Year of Death|Scholar Name/.test(c.field);return {status:currentValue===intendedValue?'already_satisfied':currentValue!==String(c.oldValue??'')||sensitive?'needs_confirmation':'ok',worksheet:c.worksheet,field:c.field,currentValue,intendedValue,reason:sensitive?'Confirm this identity/status change.':''};}catch(e){return {status:'rejected',reason:e.message};}});
 if(opts.dryRun)return {status:'ok',results};
 const groups=new Map();changes.forEach((c,i)=>{if(results[i].status==='already_satisfied'||results[i].status==='rejected')return;if(results[i].status==='needs_confirmation'&&!(c.overrideAuthorized===true&&String(c.expectedCurrent??'')===results[i].currentValue))return;const r=find(c),id=r[keys[c.worksheet]],key=c.worksheet+':'+id;if(!groups.has(key))groups.set(key,{table:c.worksheet,id,expectedVersion:r._version,changes:{},confirmedStatus:true,reason:'Explicitly confirmed in Vanuatu owner Admin',operationId:crypto.randomUUID(),indexes:[]});groups.get(key).changes[c.field]=c.newValue;groups.get(key).indexes.push(i);});
 for(const payload of groups.values()){const indexes=payload.indexes;delete payload.indexes;try{await B.rpc('saveVanuatuMaster',payload);for(const i of indexes)results[i].status='ok';}catch(e){for(const i of indexes)results[i]={...results[i],status:'rejected',reason:e.message};}}
 await refresh();return {status:'ok',results};
}
w.adminWriteback={isConfigured:configured,getEndpoint:()=>endpoint||w.VANUATU_CONFIG.adminURL||'',getSecret:()=>'',setEndpoint:v=>{endpoint=String(v||'');},setSecret:()=>{},clear:()=>{endpoint='';},ping:async()=>{await refresh();return {status:'ok',country:'Vanuatu',role:B.native()?.role||'preview'};},describe:async()=>({status:'ok',worksheets:Object.keys(keys)}),write,
 readScholar:async id=>{await refresh();const fields=all('Scholars').find(r=>r['Scholar ID']===id);return {status:'ok',fields:fields||{},scholar:fields||{}};},
 readRows:async(table,id)=>{await refresh();const rows=all(table).map((r,i)=>({rowNumber:i+1,entityId:r[keys[table]],fields:r})).filter(r=>r.fields['Scholar ID']===id);for(const r of rows)rowKeys.set(table+':'+id+':'+r.rowNumber,r.entityId);return {status:'ok',rows};},
 readChangeLog:async limit=>{await refresh();return {status:'ok',rows:all('Change Log').filter(r=>r['Entity Type']!=='Operation journal').slice(-limit).reverse().map(r=>({date:String(r['Changed At']||'').slice(0,10),editor:r['Changed By'],scope:r['Entity Type']+' · '+r['Entity ID'],field:r['Field / Action'],oldValue:r['Old Value'],newValue:r['New Value'],change:r['Source / Reason'],scholarId:r['Entity Type']==='Scholars'?r['Entity ID']:'',worksheet:r['Entity Type']}))};}
};
})(window);
