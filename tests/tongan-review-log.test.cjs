const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<button data-tab="master-change-log">Log</button><button id="review-log-refresh">Refresh</button><p id="review-log-status"></p><div id="review-log-entries"></div>',{runScripts:'outside-only'}),w=dom.window;
 let calls=0,rendered;
 w.adminWriteback={readChangeLog:async limit=>{calls++;assert.equal(limit,200);return{status:'ok',rows:[{scholarId:'TNG-S0001',scholarName:'Test Scholar'}]}}};
 w.TongaChangeLog={show:async args=>{rendered=args;}};
 w.eval(fs.readFileSync('js/tongan-review-change-log.js','utf8'));
 assert.equal(calls,0,'Log is loaded only when opened');w.document.querySelector('[data-tab]').click();await new Promise(r=>setImmediate(r));
 assert.equal(calls,1);assert.equal(rendered.scholars['TNG-S0001']['Scholar Name'],'Test Scholar');w.document.querySelector('[data-tab]').click();assert.equal(calls,1);
 w.document.getElementById('review-log-refresh').click();await new Promise(r=>setImmediate(r));assert.equal(calls,2);assert.equal(w.document.getElementById('review-log-refresh').disabled,false);
 dom.window.close();console.log('PASS collaborator log lazy load, scholar names, explicit refresh and no write actions');
})().catch(e=>{console.error(e);process.exitCode=1});
