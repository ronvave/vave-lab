const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const src=p=>fs.readFileSync(p,'utf8');
(async()=>{
 let calls=[];
 const c={AbortSignal,window:{},localStorage:{getItem:()=> 'fixture'},fetch:async(url,options)=>{calls.push({url,options});return {json:async()=>({status:'ok',rows:[]})};}};
 vm.runInNewContext(src('js/tongan-admin-writeback-client.js'),c);
 await c.window.adminWriteback.readScholarSubmissions('Pending');await c.window.adminWriteback.readGeographySubmissions('Pending');await c.window.adminWriteback.readSubmissionAttachment('S1','F1');
 for(const {url,options} of calls){assert.equal(url,'fixture');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(JSON.parse(options.body).secret,'fixture');}
 c.fetch=async()=>({status:404,json:async()=>{throw Error('HTML')}});assert.match((await c.window.adminWriteback.readScholarSubmissions()).error,/HTTP 404/);
 for(const kind of ['scholar','geography']){
 const dom=new JSDOM(`<span id="db-status">ready</span><button class="active" data-tab="${kind==='scholar'?'scholar':'geography'}-submissions">Queue</button><div data-tonga-queue="${kind}"></div>`,{runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 let reads=0,fail=false,rows=[{'Submission ID':'S1',Status:'Pending',proposedChanges:[{key:'title',label:'Title',currentValue:'Old',newValue:'New',writable:true}]}],intervals=[];
 w.setInterval=fn=>intervals.push(fn);w.setTimeout=()=>{};let now=100000;w.Date.now=()=>now;
 const read=async()=>{reads++;if(fail)throw Error('HTTP 404');return{status:'ok',rows};};
 w.adminWriteback={isConfigured:()=>true,readScholarSubmissions:read,readGeographySubmissions:read,reviewCapabilities:async()=>({status:'ok',version:4,selectionReview:true}),reviewQueueCounts:async()=>({status:'ok',scholar:rows.length,geography:rows.length})};
 w.eval(src('js/tongan-submissions-admin.js'));const tick=()=>new Promise(r=>setTimeout(r,0)),tab=w.document.querySelector('button');tab.click();await tick();assert.equal(reads,1);
 const note=w.document.querySelector('textarea');note.value='Keep my note';note.dispatchEvent(new w.Event('input',{bubbles:true}));
 now+=31000;intervals.forEach(f=>f());await tick();assert.equal(reads,1,'Idle refresh preserves an in-progress review');
 fail=true;tab.click();await tick();assert.match(w.document.querySelector('.tonga-queue-status').textContent,/404/);assert.equal(w.document.querySelector('textarea').value,'Keep my note');assert.equal(w.document.querySelector('.tonga-submission-badge').textContent,'?');
 fail=false;tab.click();await tick();assert.equal(w.document.querySelector('textarea').value,'Keep my note');
 rows=[];now+=31000;intervals.forEach(f=>f());await tick();assert.equal(w.document.querySelectorAll('.tonga-review').length,0,'Other reviewer completion removed on idle refresh');assert(w.document.querySelector('.tonga-submission-badge').hidden);assert.match(w.document.body.textContent,/Last refreshed from Master/);dom.window.close();
 }
 console.log('PASS POST reads, HTML 404 feedback, both queues reopen/idle refresh, preserved notes, failed refresh and external completion');
})().catch(e=>{console.error(e);process.exitCode=1;});
