/* Run with node tests/tongan-card-mobility.test.cjs. Decrypt only in memory. */
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict'),path=require('node:path');
process.chdir(path.resolve(__dirname,'..'));
const source=p=>fs.readFileSync(p,'utf8');
const pass=Buffer.from(source('js/tongan-demo-gate.js').match(/BAKED_PASSCODE = atob\('([^']+)'/)[1],'base64');
const cache=new Map();
async function fetchJson(url){
 if(cache.has(url))return cache.get(url);
 const b=fs.readFileSync(url+'.enc');assert.equal(b.subarray(0,4).toString(),'IVAV');
 const key=crypto.pbkdf2Sync(pass,b.subarray(4,20),200000,32,'sha256'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(20,32));
 d.setAuthTag(b.subarray(-16));const data=JSON.parse(Buffer.concat([d.update(b.subarray(32,-16)),d.final()]));cache.set(url,data);return data;
}
(async()=>{
 const window={dbGate:{fetchJson}},ctx=vm.createContext({window,console,fetch:async()=>({ok:false}),URLSearchParams,setTimeout});
 vm.runInContext(source('js/tongan-database-adapter.js'),ctx);
 const call=source('js/tongan-database-master.js').match(/const bundle = await (window\.MasterFileAdapter\.load\([^;]+);/)[1];
 const bundle=await vm.runInContext('(async()=>'+call+')()',ctx);
 const enrichment=await fetchJson('data/tongan-scholar-enrichment.json'),insights=await fetchJson('data/tongan-scholar-insights-master.json');
 const profiles=new Map(bundle.profiles.scholars.map(p=>[p.scholarId,p]));let photos=0,summaries=0;
 for(const s of bundle.master.scholars){
  const id=s['Scholar ID'];
  if(enrichment.scholars[id]?.photo){assert.equal(profiles.get(id)?.photo,s['Photo URL']||enrichment.scholars[id].photo);photos++;}
  if(insights.scholars[id]?.summaryHtml){assert.equal(bundle.insightsDoc.byScholarId[id]?.summaryHtml,insights.scholars[id].summaryHtml);assert.deepEqual(bundle.insightsDoc.byScholarId[id]?.keywords,insights.scholars[id].keywords);summaries++;}
 }
 assert(photos>0&&summaries>0,'Saved Admin content missing');
 const paired=require('../js/tongan-mobility-model.js');
 const raw=process.env.TONGAN_MOBILITY_FIXTURE?JSON.parse(source(process.env.TONGAN_MOBILITY_FIXTURE)):bundle.master.mobility;
 const result=paired.rows(raw,bundle.master.scholars,bundle.master.gradDegrees);
 assert.equal(result.rejected.length,0,'Unknown IDs/status conflicts require investigation');
 assert.equal(result.rows.length+result.excluded.length+result.duplicates.length,raw.length);
 assert(result.rows.length>0);assert(result.rows.every(r=>/^TNG-S\d+$/.test(r.scholar_id)));
 const chord=source('tongan-chord-flanked.html');
 const modelContext=vm.createContext({rows:result.rows});
 const constants=chord.slice(chord.indexOf('const SHORT ='),chord.indexOf('/* ---- 3. Build'));
 const modelSource=chord.slice(chord.indexOf('function buildModel('),chord.indexOf('/* ---- 3b. TOOLTIP'));
 const actual=vm.runInContext(constants+modelSource+';buildModel(rows,EMBEDDED_UNSD)',modelContext);
 assert(actual.uni_list.every(u=>u.region!=='Other'),'Unclassified geography');
 assert.equal(new Set(actual.uni_list.map(u=>u.n)).size,actual.uni_list.length);
 assert(actual.uni_list.every(u=>actual.num[u.uni]===u.n));
 assert(actual.flows.some(f=>f.source===f.target),'Same-university pathways missing');
 const fixture={...raw.find(r=>r.m_uni&&r.p_uni&&r.m_country&&r.p_country),'Scholar ID':'TNG-S9999',scholar_id:17};
 const roster=[{'Scholar ID':'TNG-S9999','Scholar Name':'Synthetic test scholar'}];
 const episodes=paired.rows([fixture,{...fixture},{...fixture,m_year:2098},{...fixture,'Scholar ID':'',scholar_id:17}],roster,[]);
 assert.equal(episodes.rows.length,2,'Distinct episodes must survive');assert.equal(episodes.duplicates.length,1);assert.equal(episodes.rejected.length,1,'Never pad numeric IDs');
 const missing=paired.rows([{...fixture,m_uni:'not found'}],roster,[]);assert.equal(missing.excluded.length,1);
 const explicit={...fixture,"Master's Degree ID":'TEST-M','PhD Degree ID':'TEST-P'};
 assert.equal(paired.rows([explicit],roster,[{'Degree ID':'TEST-M','Scholar ID':'TNG-S9999','Completion Status':'Uncertain'}]).rejected.length,1);
 assert.equal(paired.rows([explicit],roster,[{'Degree ID':'TEST-M','Scholar ID':'TNG-S9999','Completion Status':'Completed'},{'Degree ID':'TEST-P','Scholar ID':'TNG-S9999','Completion Status':'Ongoing'}]).rows.length,1);
 let drawn;const statusEl={textContent:''};
 Object.assign(ctx,{TonganMobility:paired,currentUnsd:{},statusEl,configureCohortLabels(){},document:{body:{classList:{add(){}}},getElementById:()=>({addEventListener(){}})},buildModel:r=>({flows:r,uni_list:[...new Set(r.flatMap(x=>[x.m_uni,x.p_uni]))]}),draw:m=>{drawn=m;}});
 window.parent={dbGate:{isUnlocked:()=>true,fetchJson:url=>url==='data/tongan-master-mobility.json'?Promise.resolve(raw):fetchJson(url)}};
 await vm.runInContext(chord.slice(chord.indexOf('async function init(){'),chord.indexOf('// ---- upload wiring'))+';init()',ctx);
 assert.equal(drawn.flows.length,result.rows.length);assert.equal(drawn.excludedPathways,result.excluded.length);
 assert(!chord.includes('const EMBEDDED_FALLBACK'));
 assert.match(chord,/window.parent === window/);
 assert.match(source('scripts/tongan_master_file_config.py').split('MOBILITY_PUBLIC_FIELDS = [')[1].split(']')[0],/"Scholar ID"/);
 const dashboard=source('tongan-research-database-master.html');
 const clickBody=dashboard.match(/doc\.addEventListener\('click', function\(ev\)\{([\s\S]*?)\n          \}\);/)[1];
 let expanded=true,toggles=0;const menu={open:true};
 const clickContext=vm.createContext({wrap:{id:'db-embed-b3-chord',classList:{contains:()=>expanded}},doc:{querySelectorAll:()=>menu.open?[menu]:[]},toggleFullscreen:(_,on)=>{expanded=on;toggles++;}});
 vm.runInContext('var handler=function(ev){'+clickBody+'};',clickContext);
 const outside={target:{closest:()=>null}};clickContext.handler(outside);
 assert(!menu.open&&expanded);clickContext.handler(outside);assert.equal(toggles,0);
 expanded=false;clickContext.handler({target:{closest:()=>({})}});assert(!expanded,'Controls must not expand');clickContext.handler(outside);assert(expanded);
 assert.match(dashboard,/doc.addEventListener\('keydown', onKey\)/);
 const keyBody=dashboard.slice(dashboard.indexOf('    function onKey(ev){'),dashboard.indexOf('    // Same-origin iframes swallow clicks'));
 const keyContext=vm.createContext({document:{querySelectorAll:()=>expanded?[{}]:[]},toggleFullscreen:()=>{expanded=false;}});
 vm.runInContext(keyBody,keyContext); menu.open=true;expanded=true;
 const escape={key:'Escape',target:{ownerDocument:{querySelector:()=>menu.open?menu:null}},preventDefault(){},stopPropagation(){}};
 keyContext.onKey(escape);assert(!menu.open&&expanded,'First Escape closes menu only');keyContext.onKey(escape);assert(!expanded,'Second Escape exits');

 assert.match(chord,/body\.is-tongan\.is-embed-fullscreen \.legend-flank\.is-compact\s*\{ grid-template-columns:minmax\(0,1fr\) minmax\(360px,54%\) minmax\(0,1fr\);/);
 assert.match(chord,/const compact = rows.length <= 54/);
 assert.match(chord,/minmax\(360px,38%\)/);
 // Exercise viewport fitting against tall, wide, compact and large figures.
 const fitSource=chord.slice(chord.indexOf('function fitExpandedMobility(){'),chord.indexOf('// Re-balance the flanked legend'));
 for(const [width,height,naturalWidth,naturalHeight] of [[2024,820,2024,1010],[1342,530,1342,710],[1000,420,1000,900],[760,400,1000,650]]){
  const style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};
  const figure={style,hidden:false,getBoundingClientRect:()=>({width:naturalWidth,height:naturalHeight})};
  const fitContext=vm.createContext({document:{body:{classList:{contains:()=>true}},getElementById:()=>figure,querySelector:()=>({clientWidth:width,clientHeight:height})}});
  vm.runInContext(fitSource+';fitExpandedMobility()',fitContext);
  const scale=Number(style.transform.match(/scale\(([^)]+)\)/)[1]);
  assert(naturalWidth*scale<=width+0.001&&naturalHeight*scale<=height+0.001,'Entire figure must fit both dimensions');
  assert.equal(style['--mobility-chart-height'],height+'px');
 }
 assert.match(chord,/min-height:0 !important; min-width:0/);
 assert.match(chord,/height:100dvh/);
 const share=source('s.html');assert.match(share,/visibility:hidden/);assert.match(share,/profile-ready/);
 console.log('PASS Tonga:',photos,'photos;',summaries,'saved summaries;',new Set(actual.flows.map(f=>f.scholar_id)).size,'scholars;',actual.flows.length,'pathways;',actual.uni_list.length,'universities;',new Set(actual.uni_list.map(u=>u.country)).size,'countries;',new Set(actual.uni_list.map(u=>u.region)).size,'regions;',result.excluded.length,'excluded.');
 console.log('PASS Tonga: canonical IDs, deduplication, distinct degree episodes, ongoing PhD, source loader, gated standalone, dropdown dismissal, compact fullscreen contract.');
})().catch(e=>{console.error(e);process.exitCode=1;});

