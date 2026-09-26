const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/tongan-admin-writeback-client.js','utf8');
(async()=>{
 let calls=[];let outcome={status:'ok'},lost=false;
 const ctx={AbortSignal,window:{},localStorage:{getItem:()=> 'fixture'},fetch:async(url,opts)=>{calls.push(opts.method);if(lost)throw Error('network');return{json:async()=>outcome};}};
 vm.runInNewContext(source,ctx);const api=ctx.window.adminWriteback;
 assert.equal((await api.resolveScholarSubmission('S1','reject','')).status,'ok');assert.deepEqual(calls,['POST'],'Successful durable response needs no extra full queue reads');
 calls=[];lost=true;const result=await api.reviewScholarSelection('S1',[],[],'');assert.equal(result.status,'error');assert.match(result.error,/acknowledgement was lost/);assert.deepEqual(calls,['POST'],'No automatic replay after uncertain response');
 lost=false;outcome={status:'already_resolved'};assert.equal((await api.resolveScholarSubmission('S1','reject','')).status,'already_resolved');
 console.log('PASS durable acknowledgement, no redundant reads, lost response retained, conflicting decision not reported as success');
})().catch(e=>{console.error(e);process.exitCode=1;});
