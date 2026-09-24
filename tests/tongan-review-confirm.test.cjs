const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/tongan-admin-writeback-client.js','utf8');
async function fixture(rows,post={status:'error',error:'non-JSON response (HTTP 404)'}){
 let writes=0;const ctx={window:{},localStorage:{getItem:()=> 'fixture'},setTimeout:fn=>fn(),fetch:async(url,opts)=>{if(opts.method==='POST'){writes++;return{json:async()=>post};}return{json:async()=>({status:'ok',rows})};}};
 vm.runInNewContext(source,ctx);return{api:ctx.window.adminWriteback,writes:()=>writes};
}
(async()=>{
 let f=await fixture([{'Submission ID':'S1',Status:'Rejected'}]);
 assert.equal((await f.api.resolveScholarSubmission('S1','reject','')).verified,true);assert.equal(f.writes(),1);
 f=await fixture([]);assert.equal((await f.api.resolveScholarSubmission('S1','reject','')).status,'error');assert.equal(f.writes(),1);
 f=await fixture([{'Submission ID':'S1',Status:'Pending'}]);assert.equal((await f.api.resolveScholarSubmission('S1','reject','')).status,'error');
 f=await fixture([{'Submission ID':'S1',Status:'Reviewed'}]);assert.equal((await f.api.resolveScholarSubmission('S1','reject','')).status,'error');
 const plan={items:[{kind:'text',key:'title',selected:true,state:'applied'}]};
 f=await fixture([{'Submission ID':'S1',Status:'Pending',reviewPlan:plan}]);
 assert.equal((await f.api.beginScholarReview('S1',[{key:'title'}],[],'')).verified,true);
 assert.equal((await f.api.beginScholarReview('S1',[{key:'gender'}],[],'')).status,'error');
 assert.equal((await f.api.approveScholarSubmission('S1',[],'')).verified,true);
 f=await fixture([{'Submission ID':'S1',Status:'Reviewed',reviewPlan:plan}]);assert.equal((await f.api.finishScholarReview('S1','')).verified,true);
 console.log('Review outcome confirmation tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
