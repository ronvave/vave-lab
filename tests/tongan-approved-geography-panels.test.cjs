/* Run with jsdom on NODE_PATH. Exercises real approved Master snapshot records. */
const fs=require('fs'),assert=require('node:assert/strict'),crypto=require('crypto'),{JSDOM}=require('jsdom');
const src=p=>fs.readFileSync(p,'utf8');
const pass=Buffer.from(src('js/tongan-demo-gate.js').match(/BAKED_PASSCODE = atob\('([^']+)'/)[1],'base64');
async function fetchJson(p){if(!fs.existsSync(p+'.enc'))return JSON.parse(src(p));const b=fs.readFileSync(p+'.enc'),key=crypto.pbkdf2Sync(pass,b.subarray(4,20),200000,32,'sha256'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(20,32));d.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([d.update(b.subarray(32,-16)),d.final()]));}
const tick=()=>new Promise(r=>setTimeout(r,10));
(async()=>{
 const dom=new JSDOM(src('tongan-research-database-master.html'),{url:'https://ronvave.github.io/vave-lab/tongan-research-database-master.html',runScripts:'outside-only'}),w=dom.window;w.console={...console,error:()=>{}};w.dbGate={fetchJson,boot:()=>{}};w.fetch=async p=>({ok:true,json:()=>fetchJson(p)});w.alert=msg=>{throw Error(msg);};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.remove();};
 w.eval(src('js/tongan-clans.js')); w.eval(src('js/tongan-database-adapter.js'));
 const dashboard=src('js/tongan-database-master.js');const pos=dashboard.lastIndexOf('})();');w.eval(dashboard.slice(0,pos)+'window.testTonga={state,loadAll,renderScholarCard,renderItemCard,renderStats,renderWorldPanel,renderLeaders,computeScholarFilterNames,buildC2DivisionRows_,renderPanelD};'+dashboard.slice(pos));
 await w.testTonga.loadAll();const state=w.testTonga.state;


 const ids=['TNG-PUB3556','TNG-PUB3557','TNG-PUB3554'];
 const items=ids.map(id=>state.snapshot.items.find(it=>it._masterPublicationId===id));
 assert(items.every(Boolean),'Approved publications must be present in snapshot');
 assert(items[0]._masterIslandDivisions.includes('Tongatapu'));
 assert(items[1]._masterIslandDivisions.includes('Tongatapu'));
 assert(items[2].collections.includes(state.nonProvincialFijiKey),'National approval reaches C2 national bucket');
 const approvedRows=state.master.geography.filter(g=>String(g['Coding Basis / Evidence']).includes('Admin-reviewed scholar submission PGS-'));
 assert(approvedRows.length>0);
 for(const g of approvedRows){
  const item=state.snapshot.items.find(it=>it._masterPublicationId===g['Publication ID / BibTeX Key']);
  assert(item,'Approved publication exported');
  const country=state.snapshot.collections.find(c=>c.parent==='V3HLPDPL'&&c.name===g.Country);
  assert(country&&item.collections.includes(country.key),'B5 country collection includes approval: '+g.Country);
 }
 const realItems=state.snapshot.items;
 state.snapshot.items=items;
 let rows=w.testTonga.buildC2DivisionRows_(false,'all');
 assert.equal(rows.find(r=>r.name==='Tongatapu').total,2,'Division-only approvals counted');
 w.testTonga.renderPanelD();
 const tong=w.document.querySelector('.db-conf-panel');
 assert.equal(tong.querySelector('.db-conf-panel__total').textContent,'2');
 assert.match(tong.textContent,/2 with no district specified/);
 const districtNames=Object.keys(w.MasterFileAdapter.constants.PROVINCE_TO_CONFED).filter(d=>w.MasterFileAdapter.constants.PROVINCE_TO_CONFED[d]==='Tongatapu').slice(0,2);
 state.provincesByItem.set(items[0].key,new Set(districtNames));
 rows=w.testTonga.buildC2DivisionRows_(true,'all');
 assert.equal(rows.find(r=>r.name==='Tongatapu').total,2,'Two districts do not double-count a division');
 assert.equal(rows.find(r=>r.name==='Non-district/Tonga').total,1);
 w.testTonga.renderPanelD();
 assert.equal(tong.isConnected,false);
 assert.equal(w.document.querySelector('.db-conf-panel__total').textContent,'2');
 state.snapshot.items=realItems;
 console.log('PASS: approved national/blank-district geotags reach C2 and division summaries; distinct publication counting across districts.');
 dom.window.close();
})().catch(e=>{console.error(e);process.exit(1);});
