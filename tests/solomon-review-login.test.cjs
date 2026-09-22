const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM(fs.readFileSync('admin-solomon-review.html','utf8'),{url:'https://ronvave.github.io/vave-lab/admin-solomon-review.html',runScripts:'outside-only'}),w=dom.window;
 w.SolomonSubmissionConfig={endpoint:'https://script.google.com/macros/s/fixture/exec',googleClientId:'fixture-client'};
 let gis,requests=[];
 w.google={accounts:{id:{initialize:o=>gis=o,renderButton(){},disableAutoSelect(){}}}};
 w.fetch=async(url,options)=>{requests.push({url,options});return{json:async()=>({status:'ok',country:'Solomon Islands',role:'admin',combinedReview:true,banSubmitter:false})}};
 w.eval(fs.readFileSync('js/solomon-review-login.js','utf8'));
 await new Promise(r=>setTimeout(r,300));
 const credential=nonce=>'header.'+Buffer.from(JSON.stringify({email:'fixture@gmail.com',nonce,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
 await gis.callback({credential:credential('wrong')});assert.equal(requests.length,0,'nonce mismatch rejected before credential transport');assert.equal(w.document.getElementById('review-app').hidden,true);
 await gis.callback({credential:credential(gis.nonce)});assert.equal(w.document.getElementById('review-app').hidden,false);assert.equal(w.document.getElementById('owner-link').hidden,true);assert.match(w.document.getElementById('identity').textContent,/Admin/);
 await w.adminWriteback.resolveGeographySubmission('G1','approve','fixture');
 assert.equal(requests.length,2);for(const {url,options} of requests){assert.equal(new URL(url).search,'');assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.ok(JSON.parse(options.body).idToken);assert.equal(JSON.parse(options.body).secret,undefined);}
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 await assert.rejects(w.SolomonSubmissionAdmin.approvePhoto(),/Owner/);
 dom.window.close();console.log('PASS browser nonce, reviewer identity, hidden owner controls, credential POST-only transport, no stored credentials, explicit pending-photo behavior.');
})().catch(e=>{console.error(e);process.exit(1)});
