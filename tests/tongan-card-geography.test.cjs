/* Run: NODE_PATH=<jsdom installation>/node_modules node tests/tongan-submissions.test.cjs */
const fs=require('fs'),assert=require('node:assert/strict'),crypto=require('crypto'),{JSDOM}=require('jsdom');
const src=p=>fs.readFileSync(p,'utf8');
const pass=Buffer.from(src('js/tongan-demo-gate.js').match(/BAKED_PASSCODE = atob\('([^']+)'/)[1],'base64');
async function fetchJson(p){if(!fs.existsSync(p+'.enc'))return JSON.parse(src(p));const b=fs.readFileSync(p+'.enc'),key=crypto.pbkdf2Sync(pass,b.subarray(4,20),200000,32,'sha256'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(20,32));d.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([d.update(b.subarray(32,-16)),d.final()]));}
const tick=()=>new Promise(r=>setTimeout(r,10));
(async()=>{
 const dom=new JSDOM(src('tongan-research-database-master.html'),{url:'https://ronvave.github.io/vave-lab/tongan-research-database-master.html',runScripts:'outside-only'}),w=dom.window;w.console={...console,error:()=>{}};w.dbGate={fetchJson,boot:()=>{}};w.fetch=async p=>({ok:true,json:()=>fetchJson(p)});w.alert=msg=>{throw Error(msg);};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.remove();};
 w.eval(src('js/tongan-clans.js')); w.eval(src('js/tongan-database-adapter.js'));
 const dashboard=src('js/tongan-database-master.js');const pos=dashboard.lastIndexOf('})();');w.eval(dashboard.slice(0,pos)+'window.testTonga={state,loadAll,renderScholarCard,renderItemCard,renderStats,renderWorldPanel,renderLeaders,computeScholarFilterNames};'+dashboard.slice(pos));
 await w.testTonga.loadAll();const state=w.testTonga.state;

 const p=Array.from(state.scholarProfilesByName.values()).find(p=>p.scholarId==='TNG-S0002');
 assert.equal(p.paternalIslandDivision,'Tongatapu');assert.equal(p.paternalClan,'Haʻa Lātūhifo');
 const card=w.testTonga.renderScholarCard(p).outerHTML;
 assert.match(card,/TONGATAPU|Tongatapu/);assert(card.includes('Kolofoʻou vlg (Haʻa Lātūhifo)'));
 assert(!card.includes('(Haʻa Lātūhifo clan)'));
 const noDistrict={...p,paternalProvince:'',paternalDistrictName:''};
 assert.match(w.testTonga.renderScholarCard(noDistrict).outerHTML,/TONGATAPU|Tongatapu/);
 const maternalOnly={...p,paternalIslandDivision:'',paternalProvince:'',paternalVillage:'',paternalClan:''};
 const empty=w.testTonga.renderScholarCard(maternalOnly).outerHTML;assert.match(empty,/Tongan Scholar/i);assert.match(empty,/Village not yet added/);assert(!empty.includes('Neiafu'));
 assert(w.testTonga.renderScholarCard({...p,paternalClan:'Ha’a Lātūhifo'}).outerHTML.includes('(Haʻa Lātūhifo)'));
 w.testTonga.renderLeaders();
 const chips=w.document.querySelector('[data-scholar-clan-chips]');assert(chips);assert.match(chips.textContent,/Haʻa Lātūhifo: [1-9]/);
 state.scholarConfFilter='Tongatapu';w.testTonga.computeScholarFilterNames();assert(state.scholarFilterNames.has(p.name));
 state.scholarClanFilter='Haʻa Lātūhifo';w.testTonga.renderLeaders();
 assert(w.document.querySelector('[data-db-leaders]').textContent.includes('Kolofoʻou vlg (Haʻa Lātūhifo)'));
 console.log('PASS: real exported TNG-S0002 card, division independent of district, clan display/count/filter, maternal privacy, blank placeholder.');dom.window.close();
})().catch(e=>{console.error(e);process.exit(1);});
