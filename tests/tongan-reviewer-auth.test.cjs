const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),assert=require('node:assert/strict');
const props=new Map([['TONGA_GOOGLE_CLIENT_ID','fixture-client'],['TONGA_OWNER_EMAIL','owner@example.edu'],['TONGA_REVIEWER_EMAILS','reviewer@gmail.com'],['SHARED_SECRET','fixture-secret'],['WRITE_ENABLED','true']]);
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'};
const ctx={console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(alg,s)=>crypto.createHash(alg).update(s).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('apps-script/vendor/tonga-jwt.gs','utf8'),ctx);vm.runInContext(fs.readFileSync('apps-script/deployed/tonga-submissions-v1.gs','utf8'),ctx);
ctx.tongaGoogleKeys_=()=>[jwk];ctx.jsonOut_=x=>x;
const now=Math.floor(Date.now()/1000),base={iss:'https://accounts.google.com',aud:'fixture-client',sub:'12345678',email:'reviewer@gmail.com',email_verified:true,iat:now,exp:now+3600};
function sign(changes={},head={}){const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture-key',...head})).toString('base64url'),p=Buffer.from(JSON.stringify({...base,...changes})).toString('base64url');return h+'.'+p+'.'+crypto.sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');}
const post=body=>ctx.doPost({postData:{contents:JSON.stringify(body)}});
const token=sign();assert.equal(post({action:'reviewCapabilities',idToken:token}).role,'admin');assert.equal(post({action:'reviewCapabilities',idToken:token}).banSubmitter,false);
let reads=0,writes=0;ctx.handleReadScholarProfileSubmissions_=()=>{reads++;return{status:'ok'}};ctx.handleReadPublicationGeographySubmissions_=ctx.handleReadScholarProfileSubmissions_;ctx.handleWrite_=()=>{writes++;return{status:'ok'}};
ctx.tongaApproveScholar_=()=>{writes++;return{status:'ok',actor:ctx.ACTOR_LABEL}};ctx.handleResolvePublicationGeographySubmission_=ctx.tongaApproveScholar_;
for(const action of ['readScholarProfileSubmissions','readPublicationGeographySubmissions','approveScholarProfileSubmission','resolvePublicationGeographySubmission'])assert.equal(post({action,idToken:token}).status,'ok');
assert.equal(reads,2);assert.equal(writes,2);assert.match(ctx.ACTOR_LABEL,/reviewer@gmail.com/);
for(const action of ['write','readRows','readScholar','readChangeLog','banScholarSubmitter','setOwner','addAdmin','deleteAdmin','describe','ping'])assert.equal(post({action,idToken:token,role:'owner',email:'owner@example.edu',secret:'fixture-secret',clientTs:Date.now()}).status,'unauthorized',action);
assert.equal(writes,2);
for(const [name,t] of Object.entries({expired:sign({exp:now-1}),audience:sign({aud:'other'}),issuer:sign({iss:'evil'}),unverified:sign({email_verified:false}),thirdParty:sign({email:'reviewer@example.com'}),unknownUser:sign({email:'stranger@gmail.com'}),future:sign({iat:now+500}),missingExp:sign({exp:null}),wrongSubject:sign({sub:'999999'}),algorithm:sign({}, {alg:'none'}),tampered:token.slice(0,-8)+'AAAAAAAA'}))assert.equal(post({action:'reviewCapabilities',idToken:t,secret:'fixture-secret',clientTs:Date.now()}).status,'unauthorized',name);
props.set('TONGA_REVIEWER_EMAILS','');assert.equal(post({action:'reviewCapabilities',idToken:token}).status,'unauthorized','revocation applies to current token');
props.set('TONGA_REVIEWER_EMAILS','reviewer@gmail.com');assert.equal(post({action:'reviewCapabilities',idToken:token}).role,'admin');
const owner=sign({email:'owner@example.edu',hd:'example.edu',sub:'87654321'});assert.equal(post({action:'reviewCapabilities',idToken:owner}).role,'owner');assert.equal(post({action:'write',idToken:owner}).status,'ok');
assert.equal(post({action:'reviewCapabilities',secret:'fixture-secret',clientTs:Date.now()}).role,'owner');
assert.equal(ctx.doGet({parameter:{action:'reviewCapabilities',idToken:token}}).status,'unauthorized','Google tokens never accepted in URL');
props.set('TONGA_OWNER_EMAIL','');assert.equal(post({action:'reviewCapabilities',idToken:token}).status,'unauthorized','owner setting required');
// A reviewer cannot claim an uploaded headshot was published.
ctx.TONGA_REQUEST_ROLE='admin';ctx.tongaWithSubmission_=(b,fn)=>fn({}, {'Scholar ID':'TNG-S0001'});ctx.tongaReviewPlan_=()=>({items:[{kind:'file',key:'photo',selected:true,state:'pending',field:'headshot'}]});
assert.throws(()=>ctx.tongaRecordAttachment_({fileId:'photo',disposition:'published',evidence:'img/scholars/TNG-S0001.jpg'}),/Owner/);
console.log('PASS signed RSA credentials, issuer/audience/expiry/algorithm, identity binding, revocation, owner-only routes, both queues, audit actor, photo enforcement, recovery path, URL credential rejection.');
