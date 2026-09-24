const fs=require('fs'),assert=require('node:assert/strict'),vm=require('vm'),{JSDOM}=require('jsdom');
const html=fs.readFileSync('admin-tongan-master.html','utf8'),src=fs.readFileSync('js/admin-tongan-master.js','utf8');
const doc=new JSDOM(html).window.document;
for(const side of ['paternal','maternal']){
 const division=doc.getElementById('me-div-'+side+'-derived');
 assert.equal(division.tagName,'SELECT');assert.equal(division.disabled,false);
 const grid=division.closest('.form-grid');
 assert.deepEqual([...grid.querySelectorAll('input,select')].map(x=>x.id),['me-div-'+side+'-derived','me-prov-'+side,'me-clan-'+side,'me-vil-'+side]);
 assert.equal(doc.getElementById('me-prov-'+side).tagName,'INPUT');
 assert.equal(doc.getElementById('me-isl-'+side),null);
}
const start=src.indexOf('  async function refreshMasterForScholar (sid) {'),end=src.indexOf('  // Load the Master sheet',start);
const ctx={state:{scholarById:{S1:{'Clan Paternal':'old'}}},adminWriteback:{readScholar:async()=>({status:'ok',fields:{'Clan Paternal':'new','Paternal Island Division':'Tongatapu','District Paternal':''}})},log(){}};
vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
(async()=>{assert.equal(await ctx.refreshMasterForScholar('S1'),true);assert.equal(ctx.state.scholarById.S1['Clan Paternal'],'new');assert.equal(ctx.state.scholarById.S1['District Paternal'],'');ctx.adminWriteback.readScholar=async()=>({status:'error'});assert.equal(await ctx.refreshMasterForScholar('S1'),false);console.log('PASS Admin geography layout and live Master refresh');})().catch(e=>{console.error(e);process.exitCode=1});
