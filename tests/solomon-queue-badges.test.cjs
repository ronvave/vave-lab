const {JSDOM}=require('jsdom'),assert=require('node:assert/strict'),fs=require('fs');
(async()=>{
 const dom=new JSDOM('<span id="db-status">unlocking…</span><button data-tab="scholar-submissions">Scholar</button><button data-tab="geography-submissions">Geography</button><div data-solomon-queue="scholar"></div><div data-solomon-queue="geography"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;let count=2,fail=false,calls=0;const timers=[];
 w.setInterval=fn=>timers.push(fn);w.setTimeout=fn=>timers.push(fn);
 w.adminWriteback={isConfigured:()=>true,readScholarSubmissions:async status=>{calls++;assert.equal(status,'Pending');if(fail)throw Error('offline');return{status:'ok',rows:Array.from({length:count},(_,i)=>({'Submission ID':String(i),Status:'Pending','Attachments JSON':JSON.stringify([{field:'headshot',name:'Scholar.jpg',fileId:'photo',type:'image/jpeg',size:2048}])}))}},readSubmissionAttachment:async()=>({status:'ok',type:'image/jpeg',name:'Scholar.jpg',data:'/9j/'}),readGeographySubmissions:async()=>({status:'ok',rows:[{}]})};
 w.eval(fs.readFileSync('js/solomon-submissions-admin.js','utf8'));
 const tick=()=>new Promise(r=>setImmediate(r));timers.forEach(f=>f());await tick();assert.equal(calls,0,'Wait for unlock');
 w.document.getElementById('db-status').textContent='ready';await tick();
 const badges=w.document.querySelectorAll('.solomon-submission-badge');assert.equal(badges[0].textContent,'2');assert.equal(badges[1].textContent,'1');assert.equal(w.document.querySelectorAll('.solomon-review').length,0,'Counts load before tab opened');
 w.document.querySelector('[data-tab="scholar-submissions"]').click();await tick();assert.equal(w.document.querySelector('.solomon-attachment-preview img').getAttribute('src'),'data:image/jpeg;base64,/9j/');assert.match(w.document.querySelector('.solomon-attachments').textContent,/Scholar.jpg/);const notes=w.document.querySelector('textarea');notes.value='Keep my review notes';count=3;timers.forEach(f=>f());await tick();assert.equal(badges[0].textContent,'3');assert.equal(notes.value,'Keep my review notes');
 fail=true;w.dispatchEvent(new w.Event('focus'));await tick();assert.equal(badges[0].textContent,'3','Network failure must not imply zero');
 fail=false;count=0;w.dispatchEvent(new w.Event('focus'));await tick();assert(badges[0].hidden,'Hide zero pending');dom.window.close();
 console.log('PASS: badges load after unlock before tab click; both queues refresh; notes survive polling; failures retain count; zero hides badge.');
})().catch(e=>{console.error(e);process.exit(1)});
