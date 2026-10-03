/* Simulated DOM integration, not rendered-browser acceptance. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require(process.env.VANUATU_JSDOM_PATH||'jsdom');
const tick=()=>new Promise(r=>setTimeout(r,30));
async function ready(test){for(let i=0;i<100;i++){if(test())return;await tick();}throw Error('Timed out waiting for DOM hydration');}
function create(file,query='?preview=1'){
 const errors=[],requests=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',(...args)=>errors.push(args.map(String).join(' ')));
 const dom=new JSDOM(fs.readFileSync(file,'utf8'),{url:'https://example.invalid/'+file+query,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};w.ResizeObserver=w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.confirm=()=>true;w.alert=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.fetch=async url=>{const p=String(url).split('?')[0];requests.push(p);if(p==='data/vanuatu-provinces.geojson')return{ok:true,json:async()=>JSON.parse(fs.readFileSync(p,'utf8'))};return{ok:false,status:404};};
 for(const script of w.document.querySelectorAll('script[src]')){const src=script.getAttribute('src').split('?')[0];if(src.startsWith('js/'))w.eval(fs.readFileSync(src,'utf8'));}
 return {dom,w,d:w.document,errors,requests};
}
(async()=>{
 let c=create('vanuatu-research-database-master.html');await ready(()=>c.w.__masterHydrated);const {w,d}=c;
 assert(d.getElementById('vanuatu-preview-notice').textContent.includes('FICTIONAL'));
 const original=new JSDOM(fs.readFileSync('tongan-research-database-master.html','utf8'));
 assert.deepEqual([...d.querySelectorAll('[data-panel]')].map(x=>x.dataset.panel),[...original.window.document.querySelectorAll('[data-panel]')].map(x=>x.dataset.panel));original.window.close();
 assert.equal(d.querySelectorAll('.db-scholar-card').length,3);assert.equal(w.__vavelabDbState.provinces.features.length,6);
 assert(d.querySelector('[data-conf-total="Sanma"]').textContent !== '—');
 assert(!d.body.textContent.includes('Division TOTAL'));
 assert.deepEqual(Object.keys(w.MasterFileAdapter.constants.CONFEDERACIES),Array.from(w.VanuatuGeography.provinces));
 d.querySelector('[data-scholar-name-search]').value='Example Scholar B';d.querySelector('[data-scholar-name-search]').dispatchEvent(new w.Event('input'));await ready(()=>d.querySelectorAll('.db-scholar-card').length===1);assert.equal(d.querySelectorAll('.db-scholar-card').length,1);assert(d.querySelector('.db-scholar-card').textContent.includes('Example Scholar B'));
 d.querySelector('[data-scholar-clear-all]').click();assert.equal(d.querySelectorAll('.db-scholar-card').length,3);
 const body=await w.dbGate.fetchJson('data/vanuatu-body-composition-master.json');assert.equal(body.Woman.scholars,1);assert.equal(body.Man.scholars,1);assert.equal(body.Man.report,1);
 assert(c.requests.every(x=>!x.includes('tongan')&&!x.includes('script.google')&&!x.includes('formsubmit')));assert.equal(c.errors.length,0,c.errors.join('\n'));c.dom.window.close();
 c=create('vanuatu-research-database-master.html','?preview=1&scholar=VAN-S9001');await ready(()=>c.d.querySelector('.vanuatu-portal'));assert.equal(c.d.querySelectorAll('.db-scholar-card').length,1);assert(c.d.body.textContent.includes('FICTIONAL'));assert(!c.d.querySelector('[data-panel="G"]'));assert.equal(c.errors.length,0,c.errors.join('\n'));c.dom.window.close();
 c=create('admin-vanuatu-master.html');await ready(()=>c.d.getElementById('db-status').textContent==='ready');assert(c.d.getElementById('dashboard').classList.contains('is-visible'));assert.equal(c.d.querySelectorAll('#scholars-tbody tr[data-sid]').length,3);assert.equal(c.d.getElementById('filter-island-division').querySelectorAll('option').length,7);
 c.d.getElementById('filter-island-division').value='Shefa';c.d.getElementById('filter-island-division').dispatchEvent(new c.w.Event('change'));assert.equal(c.d.querySelectorAll('#scholars-tbody tr[data-sid]').length,1);
 c.d.querySelector('#scholars-tbody tr[data-sid]').click();await ready(()=>c.d.getElementById('modal-save').disabled);await ready(()=>c.d.querySelectorAll('#graddegrees-container .me-row-input').length>0);assert.equal(c.d.getElementById('me-div-paternal-derived').value,'Shefa');assert.equal(c.d.getElementById('me-prov-paternal').value,'Efate');assert.equal(c.d.getElementById('me-gender').value,'Male');assert(c.d.getElementById('me-clan-paternal').querySelector('option[value="North Efate"]'));
 c.d.getElementById('me-div-paternal-derived').value='Sanma';c.d.getElementById('me-div-paternal-derived').dispatchEvent(new c.w.Event('change'));assert(c.d.getElementById('me-clan-paternal').querySelector('option[value="East Malo"]'));assert(!c.d.getElementById('me-clan-paternal').querySelector('option[value="North Efate"]'));assert.equal(c.d.getElementById('me-prov-paternal').value,'Efate','Island must not be inferred from changed province');
 await assert.rejects(c.w.adminWriteback.write([]),/authorized Vanuatu owner/);assert(c.d.getElementById('refresh-master').disabled);assert(c.d.getElementById('top-force-refresh').disabled);assert.equal(c.errors.length,0,c.errors.join('\n'));c.dom.window.close();
 c=create('admin-vanuatu-master.html','');await tick();assert(!c.w.VanuatuBundle.current());assert(!c.d.getElementById('dashboard').classList.contains('is-visible'));assert.equal(c.requests.length,0);c.dom.window.close();
 console.log('PASS: full reference panels, six provinces, linked scholar filters, shared profiles, gender/report counts, original Admin editor, independent geography, read-only preview and isolated requests.');
})().catch(e=>{console.error(e);process.exit(1);});
