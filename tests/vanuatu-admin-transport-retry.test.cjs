const fs=require('fs'),vm=require('vm'),assert=require('assert');
async function run(seq,method){let n=0;const store={};const w={VanuatuBundle:{disconnectAdmin(){},current:()=>null,native:()=>null,isPreview:()=>false,rpc(){}},addEventListener(){},dispatchEvent(){}};
 const sb={window:w,localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:k=>k==='vanuatu.admin.secret'?'s'.repeat(40):null,setItem(){}},setTimeout:(f)=>f(),Event:class{},
  fetch:async()=>{const x=seq[Math.min(n++,seq.length-1)];if(x===404)return {ok:false,status:404};if(x==='html')return {ok:true,status:200,json:async()=>{throw Error('bad')}};return {ok:true,status:200,json:async()=>x};},console};
 sb.self=w;vm.createContext(sb);let src=fs.readFileSync('js/vanuatu-admin-writeback-client.js','utf8');vm.runInContext('(function(w){'+'})',sb);
 vm.runInContext(src.replace(/\(window\)\s*;?\s*$/,'(window);'),sb);
 try{const r=await w.VanuatuAdminTransport.call(method,{});return ['ok',r,n];}catch(e){return ['err',e.message,n];}}
(async()=>{
 let r=await run([404,404,{ok:true,result:{tables:{}}}],'getVanuatuAdminState');assert.equal(r[0],'ok');assert.equal(r[2],3);
 r=await run(['html',{ok:true,result:1}],'getVanuatuAdminState');assert.equal(r[0],'ok');
 r=await run([404,{ok:true,result:1}],'saveVanuatuMaster');assert.equal(r[0],'err');assert.equal(r[2],1);assert.match(r[1],/may already be saved/);
 r=await run([{ok:false,error:'Owner authentication failed.'}],'getVanuatuAdminState');assert.equal(r[1],'Owner authentication failed.');assert.equal(r[2],1);
 r=await run([404],'getVanuatuAdminState');assert.equal(r[0],'err');assert.equal(r[2],4);
 console.log('PASS retry: reads retried on 404/unreadable, writes never re-sent, server errors shown');})();
