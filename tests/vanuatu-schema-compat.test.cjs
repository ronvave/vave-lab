const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T={
 'Scholars':[['t'],['d'],[''],['Scholar ID','Scholar Name','ORCID','Current Leadership Category','Lineage / Provenance Notes','Created At'],['VAN-S0001','A','https://orcid.org/0000-0001','Regional','note','x']],
 'Scholar Profile Submissions':[['t'],['d'],[''],['Submission ID','Status','Submitter Email (private)','Scholar ID'],['SUB-1','Pending','private@example.invalid','VAN-S0001']],
 'Positions':[['t'],['d'],[''],['Position ID','Scholar ID','Title (verbatim)','Last Verified'],['VAN-POS1','VAN-S0001','Lecturer','2026-10-11']],
 'Graduate Degrees':[['t'],['d'],[''],['Degree ID']],'Publications':[['t'],['d'],[''],['Publication ID']],'Authorship':[['t'],['d'],[''],['Authorship ID']],'Review Queue':[['t'],['d'],[''],['Candidate ID','Submitted At']],'Publication Geography Submissions':[['t'],['d'],[''],['Submission ID','Submitter Email (private)']],'Change Log':[['t'],['d'],[''],['Change ID']]};
function sheet(name){const v=T[name];const w=Math.max(...v.map(r=>r.length));return {getLastColumn:()=>w,getLastRow:()=>v.length,getSheetId:()=>1,
 getRange:(r,c,nr,nc)=>({getDisplayValues:()=>v.slice(r-1,r-1+nr).map(row=>{const o=[];for(let j=0;j<nc;j++)o.push(row[c-1+j]??'');return o;}),getFormula:()=>''})};}
const sb={Session:{getActiveUser:()=>({getEmail:()=>'owner@example.invalid'})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='VANUATU_ROLES'?JSON.stringify({'owner@example.invalid':'owner'}):null})},
 SpreadsheetApp:{openById:()=>({getSheetByName:n=>T[n]?sheet(n):null})},Utilities:{base64EncodeWebSafe:x=>Buffer.from(x).toString('base64url'),computeDigest:(_,s)=>require('node:crypto').createHash('sha256').update(s).digest(),DigestAlgorithm:{SHA_256:'SHA'},getUuid:()=>'u'},console};
vm.createContext(sb);vm.runInContext(fs.readFileSync('apps-script/vanuatu-master-writeback.gs','utf8'),sb);
sb.vanEnrichment_=()=>({});
const d=sb.vanData_('Scholars');const r=d.records[0].value;
assert.equal(r['ORCID / Researcher ID'],'https://orcid.org/0000-0001');assert.equal(r['Leadership Category'],'Regional');assert.equal(r['Community / Ancestral Notes'],'note');assert.ok(!('ORCID' in r));
const u=sb.vanUpdate_(d,5,'ORCID / Researcher ID','https://orcid.org/0000-0002');assert.equal(u.updateCells.range.startColumnIndex,2);
const p=sb.vanData_('Positions').records[0].value;assert.equal(p['Title / Role'],'Lecturer');assert.equal(p['Last Checked'],'2026-10-11');
const st=sb.getVanuatuAdminState();const sub=st.tables['Scholar Profile Submissions'][0];
assert.ok(!('Submitter Email' in sub)&&!('Submitter Email (private)' in sub),'email must stay hidden');
console.log('PASS legacy keys, column positions and email privacy with renamed headers');
