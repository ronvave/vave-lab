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
 const c=create('vanuatu-research-database-master.html');await ready(()=>c.w.__masterHydrated);const {d,w}=c;
 assert(!d.querySelector('[data-scholar-clan]'));
 assert(!d.querySelector('[data-scholar-clan-summary]'));
 assert.equal(d.querySelector('[data-count-islands-total]').textContent,'2');
 assert(d.querySelector('[data-island-chip="Espiritu Santo"]').textContent.includes(': 1'));
 assert.equal(d.querySelector('[data-island-chip="Espiritu Santo"]').style.getPropertyValue('--conf-color'),d.querySelector('[data-conf-chip="Sanma"]').style.getPropertyValue('--conf-color'));
 assert.equal(d.querySelectorAll('[data-island-chip]').length,66);
 const root=d.querySelector('[data-scholar-conf-combo]'); root.click();
 const parent=d.querySelector('[data-parent-col] [data-value="Sanma"]');parent.dispatchEvent(new w.Event('mouseenter'));
 const children=[...d.querySelectorAll('[data-scholar-conf-panel] [data-child-col] .dsf-combo-item')];
 assert(children.some(x=>x.textContent==='Espiritu Santo'));assert(!children.some(x=>x.textContent==='Northwest Santo'));
 children.find(x=>x.textContent==='Espiritu Santo').click();
 assert.equal(d.querySelectorAll('.db-scholar-card').length,1);assert(d.querySelector('.db-scholar-card').textContent.includes('Example Scholar A'));
 assert(root.textContent.includes('Sanma › Espiritu Santo'));
 d.querySelector('[data-scholar-clear-all]').click();assert.equal(d.querySelectorAll('.db-scholar-card').length,3);
 assert.equal(c.errors.length,0,c.errors.join('\n'));
 assert.equal(w.VanuatuGeography.island('Santo'),'Espiritu Santo');
 assert.equal(w.VanuatuGeography.scholarIslands({paternalIsland:'Santo; Espiritu Santo'}).length,1);
 c.dom.window.close();console.log('PASS: province/island hierarchy, filters, aliases, colours, counts and clear-all');
})().catch(e=>{console.error(e);process.exitCode=1;});