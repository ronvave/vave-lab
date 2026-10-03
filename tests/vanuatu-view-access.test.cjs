const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const code=fs.readFileSync('js/vanuatu-demo-gate.js','utf8');
const KEY='vavelab_vanuatu_view_password';
function page(query='',stored=''){
 const dom=new JSDOM('<main><section id="dashboard">Dashboard</section></main>',{url:'https://example.test/vanuatu-research-database-master.html'+query,runScripts:'outside-only'}),w=dom.window;
 let data=null,loads=0,copies=[];
 w.VanuatuBundle={current:()=>data,isPreview:()=>!!data?.preview,preview:()=>data={preview:true},clear:()=>data=null,fetchJson:()=>{},load:async p=>{loads++;if(!['owner-fixture','collaborator-fixture'].includes(p))throw Error('Incorrect password');data={preview:false};}};
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async t=>copies.push(t)}});
 if(stored)w.localStorage.setItem(KEY,stored);w.eval(code);
 return {w,dom,copies,loads:()=>loads};
}
(async()=>{
 for(const password of ['owner-fixture','collaborator-fixture']){
 const p=page();let boots=0;await p.w.dbGate.boot(()=>boots++);
 assert(p.w.document.querySelector('.demo-gate-shell'));
 p.w.document.querySelector('input[type=password]').value=password;
 await p.w.document.querySelector('form').onsubmit({preventDefault(){}});
 assert.equal(boots,1);assert.equal(p.w.localStorage.getItem(KEY),password);
 const refreshed=page('',p.w.localStorage.getItem(KEY));await refreshed.w.dbGate.boot(()=>{});
 assert.equal(refreshed.loads(),1);assert(!refreshed.w.document.querySelector('.demo-gate-shell'));
 await refreshed.w.document.querySelector('#vanuatu-view-controls button').onclick();
 assert.deepEqual(refreshed.copies,['https://example.test/vanuatu-research-database-master.html?preview=1']);
 refreshed.dom.window.close();p.dom.window.close();
 }
 const preview=page('?preview=1','owner-fixture');await preview.w.dbGate.boot(()=>{});assert.equal(preview.loads(),0);assert(preview.w.dbGate.isDemo());assert(preview.w.document.querySelector('#vanuatu-preview-notice'));preview.dom.window.close();
 const bad=page('','old-password');await bad.w.dbGate.boot(()=>{});assert(bad.w.document.querySelector('.demo-gate-shell'));assert.equal(bad.w.localStorage.getItem(KEY),null);bad.dom.window.close();
 console.log('PASS owner/collaborator persistence, clean shared preview, forced preview, invalid saved password recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
