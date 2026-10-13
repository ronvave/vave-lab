const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('js/admin-tongan-master.js','utf8');
const dom=new JSDOM(fs.readFileSync('admin-tongan-master.html','utf8')),document=dom.window.document;
let pushed=0,notices=[];
const ctx={document,window:{},state:{editingSid:'TNG-test'},$:s=>document.querySelector(s),$$:s=>[...document.querySelectorAll(s)],toast:t=>notices.push(t),log(){},performNonMasterPush:async()=>pushed++};vm.createContext(ctx);
function include(start,end){vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),ctx);}
include('  function setMe (','  // Load Positions');
include('  function masterInputChanged(', '  // ------------------------- Phase 3.4');
include('  function normalizeAdminOrcidInput (','  // Step 2 — commit.');
(async()=>{
 ctx.setMe('me-orcid','0000-0002-1825-0097');
 ctx.setMe('me-title','Researcher\nLecturer');
 ctx.setMe('me-record-notes','First\r\nSecond');
 ctx.setMe('me-div-paternal-derived','Vavaʻu');
 document.getElementById('pf-insights-json').value='{"keywords":["Music"],"summaryHtml":"Research summary"}';
 assert.equal(ctx.collectMasterChanges('TNG-test').length,0,'Browser normalization must not invent Master changes');
 await ctx.saveEditModal();assert.equal(pushed,1,'Insights-only save proceeds without Master endpoint');assert.equal(notices.length,0);assert.equal(document.getElementById('me-orcid').value,'0000-0002-1825-0097');
 document.getElementById('me-title').value='Professor';let changes=ctx.collectMasterChanges('TNG-test');assert.equal(changes.length,1);assert.equal(changes[0].oldValue,'Researcher\nLecturer','Exact Master value retained for conflict checking');
 await ctx.saveEditModal();assert.equal(pushed,1,'Real Master edits cannot bypass write-back');assert.match(notices.pop(),/Current Title \/ Role/);
 ctx.setMe('me-title','Researcher');document.getElementById('me-orcid').value='bad-id';await ctx.saveEditModal();assert.equal(pushed,1);assert.match(notices.pop(),/ORCID must/);
 document.getElementById('me-orcid').value='0000-0001-2345-678X';await ctx.saveEditModal();assert.equal(document.getElementById('me-orcid').value,'https://orcid.org/0000-0001-2345-678X');assert.equal(pushed,1);
 console.log('PASS insights-only save, multiline and legacy dropdown values, unchanged ORCID, exact oldValue, genuine Master edit guard and ORCID validation');dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
