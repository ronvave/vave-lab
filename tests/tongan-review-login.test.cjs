const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM(fs.readFileSync('admin-tongan-review.html','utf8'),{url:'https://ronvave.github.io/vave-lab/admin-tongan-review.html',runScripts:'outside-only'}),w=dom.window;
 let gis,requests=[],timers=[];const realTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>{timers.push({fn,ms});return realTimeout(fn,ms)};
 w.google={accounts:{id:{initialize:o=>gis=o,renderButton(){},disableAutoSelect(){}}}};
 w.fetch=async(url,options)=>{requests.push({url,options});return{json:async()=>({status:'ok',role:'admin',combinedReview:true,banSubmitter:false})}};
 w.eval(fs.readFileSync('js/tongan-review-login.js','utf8'));
 await new Promise(r=>setTimeout(r,300));
 const credential=nonce=>'header.'+Buffer.from(JSON.stringify({sub:'12345',email:'fixture@gmail.com',nonce,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
 await gis.callback({credential:credential('wrong')});assert.equal(requests.length,0,'nonce mismatch rejected before credential transport');assert.equal(w.document.getElementById('review-app').hidden,true);
 await gis.callback({credential:credential(gis.nonce)});assert.equal(w.document.getElementById('review-app').hidden,false);assert.equal(w.document.getElementById('owner-link').hidden,true);assert.match(w.document.getElementById('identity').textContent,/Admin/);
 await w.adminWriteback.resolveGeographySubmission('G1','approve','fixture');
 assert.equal(requests.length,2);for(const {url,options} of requests){assert.equal(new URL(url).search,'');assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.ok(JSON.parse(options.body).idToken);assert.equal(JSON.parse(options.body).secret,undefined);}
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 const note=w.document.createElement('textarea');note.value='Unfinished review';w.document.getElementById('review-app').append(note);
 const expire=timers.find(t=>t.ms>3500000);assert(expire);expire.fn();assert.equal(w.document.getElementById('review-app').hidden,false,'Expiry retains queue');assert.equal(w.document.getElementById('sign-in').hidden,false);
 await assert.rejects(w.adminWriteback.readChangeLog(),/Sign in again/);
 await gis.callback({credential:credential(gis.nonce)});assert.equal(note.value,'Unfinished review');assert.equal(note.isConnected,true);assert.equal(w.document.getElementById('sign-in').hidden,true);
 await w.adminWriteback.readChangeLog(200);assert.equal(JSON.parse(requests.at(-1).options.body).action,'readChangeLog');
 await assert.rejects(w.TongaSubmissionAdmin.approvePhoto(),/Owner/);
 dom.window.close();console.log('PASS browser nonce, reviewer identity, hidden owner controls, credential POST-only transport, no stored credentials, explicit pending-photo behavior.');
})().catch(e=>{console.error(e);process.exit(1)});
