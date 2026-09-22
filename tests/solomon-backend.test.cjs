const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),crypto=require('crypto');
class Sheet{
 constructor(rows){this.rows=rows;}
 appendRow(r){this.rows.push(r);}
 getLastRow(){return this.rows.length;} getLastColumn(){return Math.max(0,...this.rows.map(r=>r.length));}
 getMaxRows(){return 1000;}getMaxColumns(){return 100;}insertRowsAfter(){}insertColumnsAfter(){}setFrozenRows(){}
 getRange(row,col,n=1,m=1){const self=this;return{
 getValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>self.rows[row+i-1]?.[col+j-1]??''));},
 getDisplayValues(){return this.getValues().map(r=>r.map(String));},getValue(){return this.getValues()[0][0];},getDisplayValue(){return String(this.getValue());},
 getFormula(){return '';},getFormulas(){return Array.from({length:n},()=>Array(m).fill(''));},
 setValues(values){values.forEach((r,i)=>r.forEach((v,j)=>{self.rows[row+i-1]??=[];self.rows[row+i-1][col+j-1]=v;}));return this;},
 setValue(v){return this.setValues([[v]]);}
 };}
}
const sid='SOL-S0001',token='a'.repeat(40);
const sheets={
 Scholars:new Sheet([['Scholar ID','Scholar Share Token','Current Role','Gender','Current Institution ID','Maternal Village/Community'],[sid,token,'Old','Man','I1','Private village']]),
 'Graduate Degrees':new Sheet([['Degree ID','Scholar ID','Stage','Graduation Year','Institution Name (Current)'],['D1',sid,'PhD','2001','Fixture University']]),
 Institutions:new Sheet([['Institution ID','Canonical Name','Aliases/Historical Names'],['I1','Fixture University','Old Fixture University'],['I2','New University','']]),
 Authorship:new Sheet([['Publication ID','Scholar ID'],['P1',sid]]),
 'Research Geography':new Sheet([['Geography ID','Publication ID','Country','Province/City Area','Ward','Specific Island','Village/Community/Site','Geography Scale','Evidence Excerpt/Context','Source ID','Verification Status'],['G0','P2','Solomon Islands','Western','','New Georgia','Munda','Village / site','','','Verified']]),
 'Change Log':new Sheet([['Version','Date','Change','Scope/Impact','Source']])
};
const ss={getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=new Sheet([]),getId:()=> '1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY'};
const props=new Map([['SOLOMON_PUBLIC_SUBMISSIONS_ENABLED','true'],['WRITE_ENABLED','true'],['SHARED_SECRET','fixture-secret']]);
const ctx={console,SpreadsheetApp:{openById:id=>{assert.equal(id,ss.getId());return ss;}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||'',setProperty:(k,v)=>props.set(k,v)})},LockService:{getScriptLock:()=>({waitLock(){},tryLock(){return true},releaseLock(){}})},Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:()=> '2026-09-22',DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(alg,s)=>crypto.createHash(alg).update(s).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),base64Encode:b=>Buffer.from(b).toString('base64'),computeHmacSha256Signature:(s,k)=>crypto.createHmac('sha256',k).update(s).digest()}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('apps-script/solomon-master-writeback.gs','utf8'),ctx);ctx.jsonOut_=o=>o;
const post=body=>ctx.doPost({postData:{contents:JSON.stringify(body)}});
const publicBase={country:'Solomon Islands',scholarId:sid,shareToken:token,submitterName:'Fixture',submitterEmail:'fixture@example.invalid',submitterRelationship:'Self',requestId:crypto.randomUUID(),fields:{title:'New',gender:'Female',institution:'New University',phd_year:'2002'},structuredSubmission:{changedFieldsOnly:true},files:[]};
const owner=(action,args={})=>post({action,secret:'fixture-secret',clientTs:Date.now(),...args});
let result=post({...publicBase,action:'submitScholarProfileUpdate'});assert.equal(result.status,'ok',JSON.stringify(result));const id=result.submissionId;
assert.equal(post({...publicBase,action:'submitScholarProfileUpdate'}).alreadyReceived,true);
assert.equal(sheets['Scholar Profile Submissions'].getLastRow(),2);
assert.equal(sheets.Scholars.rows[1][2],'Old','Public submission cannot write Master');
let queue=owner('readScholarProfileSubmissions');assert.equal(queue.rows.length,1);
let changes=queue.rows[0].proposedChanges;assert.equal(changes.length,4);assert(changes.every(c=>c.writable),JSON.stringify(changes));
assert.equal(changes.find(c=>c.key==='institution').newValue,'I2');
assert.equal(changes.find(c=>c.key==='gender').newValue,'Woman');
result=owner('beginScholarReview',{submissionId:id,selectedChanges:changes.map(c=>({key:c.key,expectedCurrent:c.currentValue})),selectedFiles:[]});assert.equal(result.status,'ok',JSON.stringify(result));
result=owner('approveScholarProfileSubmission',{submissionId:id});assert.equal(result.status,'ok',JSON.stringify(result));
assert.equal(sheets.Scholars.rows[1][2],'New');assert.equal(sheets.Scholars.rows[1][5],'Private village','Untouched maternal data retained');
assert.equal(sheets['Graduate Degrees'].rows[1][3],2002);
result=owner('finishScholarReview',{submissionId:id});assert.equal(result.status,'ok',JSON.stringify(result));assert.equal(result.remainingReview,false);
assert.equal(post({...publicBase,shareToken:'b'.repeat(40),action:'submitScholarProfileUpdate'}).status,'unauthorized');
assert.equal(post({...publicBase,scholarId:'TNG-S0001',action:'submitScholarProfileUpdate'}).status,'unauthorized');
assert.equal(post({...publicBase,country:'Tonga',action:'submitScholarProfileUpdate'}).status,'error');
assert.notEqual(post({...publicBase,requestId:crypto.randomUUID(),fields:{paternal_district:'invalid'},action:'submitScholarProfileUpdate'}).status,'ok');
assert.throws(()=>ctx.solomonValidateFile_({field:'headshot',name:'file.html',type:'image/jpeg',data:'YWJj'}),/Unsupported/);
const geo={...publicBase,requestId:crypto.randomUUID(),action:'submitPublicationGeography',changes:[{item_key:'P1',title:'Fixture publication',solomon_locations:[{province:'Western',island:'New Georgia',village:'Munda'},{national:true}],pacific_countries:['Nauru'],other_countries:[]}]};
result=post(geo);assert.equal(result.status,'ok',JSON.stringify(result));assert.equal(post(geo).alreadyReceived,true);
queue=owner('readPublicationGeographySubmissions');assert.equal(queue.rows.length,1);assert.equal(queue.rows[0]['Proposed Pacific Countries'],'Naoero');
result=owner('resolvePublicationGeographySubmission',{submissionId:queue.rows[0]['Submission ID'],decision:'approve'});assert.equal(result.status,'ok',JSON.stringify(result));assert.equal(sheets['Research Geography'].getLastRow(),5);
assert.equal(owner('resolvePublicationGeographySubmission',{submissionId:queue.rows[0]['Submission ID'],decision:'approve'}).status,'already_resolved');
const again=post({...geo,requestId:crypto.randomUUID()});assert.equal(again.status,'ok');
queue=owner('readPublicationGeographySubmissions',{status:'Pending'});assert.equal(queue.rows.length,1);
result=owner('resolvePublicationGeographySubmission',{submissionId:queue.rows[0]['Submission ID'],decision:'approve'});assert.equal(result.status,'ok',JSON.stringify(result));assert.equal(sheets['Research Geography'].getLastRow(),5,'Approval retry preserves existing geography without duplicates');
console.log('PASS: isolated full public submission → private queue → owner review → exact Solomon Master writes; stable degree, enum/institution mapping, idempotency, maternal preservation, wrong country/token rejection, geography deduplication and audit.');
