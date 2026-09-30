const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict'),path=require('node:path');
process.chdir(path.resolve(__dirname,'..'));
const source=p=>fs.readFileSync(p,'utf8');
const pass=Buffer.from(source('js/tongan-demo-gate.js').match(/BAKED_PASSCODE = atob\('([^']+)'/)[1],'base64');
const sid='TNG-S0164',tier='Retained profile; excluded from Indigenous Tongan counts';
async function fetchJson(url){const b=fs.readFileSync(url+'.enc'),key=crypto.pbkdf2Sync(pass,b.subarray(4,20),200000,32,'sha256'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(20,32));d.setAuthTag(b.subarray(-16));const data=JSON.parse(Buffer.concat([d.update(b.subarray(32,-16)),d.final()]));if(url==='data/tongan-master-scholars.json')data.find(s=>s['Scholar ID']===sid)['Roster Tier']=tier;return data;}
(async()=>{const window={dbGate:{fetchJson}},ctx=vm.createContext({window,console,fetch:async()=>({ok:false}),URLSearchParams,setTimeout});vm.runInContext(source('js/tongan-database-adapter.js'),ctx);const call=source('js/tongan-database-master.js').match(/const bundle = await (window\.MasterFileAdapter\.load\([^;]+);/)[1];const b=await vm.runInContext('(async()=>'+call+')()',ctx);
assert(b.profiles.scholars.some(s=>s.scholarId===sid),'Retained profile missing');
assert(b.master.gradDegrees.some(d=>d['Scholar ID']===sid),'Personal degrees missing');
assert(b.master.authorship.some(d=>d['Scholar ID']===sid),'Personal bibliography missing');
for(const key of ['scholars','gradDegrees','authorship','mobility'])assert(!b.countingMaster[key].some(s=>s['Scholar ID']===sid),key+' includes excluded scholar');
assert(!Object.values(b.grad.scholars).some(s=>s.scholarId===sid),'Graduate summary includes excluded scholar');
assert.equal(b.master.scholars.length-b.countingMaster.scholars.length,1,'Only explicit exclusion applies');
assert(window.MasterFileAdapter.computePublicationTotals(b.master,sid,{excludePreprints:true,excludeDocuments:true}).total>=21,'Personal totals changed');
const model=require('../js/tongan-mobility-model.js');const all=model.rows(b.master.mobility,b.master.scholars,b.master.gradDegrees);assert(!all.rows.some(r=>r.scholar_id===sid),'B3 includes excluded scholar');
console.log('PASS retained profile, degrees, authorship and personal totals; excluded from scholar/degree/authorship/mobility summary views; blank paternal fields do not exclude others.');})();
