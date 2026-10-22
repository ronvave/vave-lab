// Phase 3 schema alignment: the Vanuatu Admin script must work with the converted
// Master (Living Status / Role Status / Changed At (UTC)) using synthetic rows only.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const H={
 Scholars:['Scholar ID','Scholar Name','Salutation','Gender','Year of Birth','Living Status','Year of Death','Identity Verification Status','Identity Evidence','Identity Source URL'],
 Positions:['Position ID','Scholar ID','Title (verbatim)','Institution','Start Year','End Year','Role Status','Last Verified'],
 'Change Log':['Change ID','Changed At (UTC)','Changed By','Entity Type','Entity ID','Field / Action','Old Value','New Value','Source / Reason','Approval / Notes','Deployment Version'],
};
const T={Scholars:[[],[],[],H.Scholars,['VAN-S9001','Test Scholar','','Female','1950','Living','','Provisional','','']],
 Positions:[[],[],[],H.Positions,['VAN-POS-90001','VAN-S9001','Lecturer','Test University','2001','2005','Former','2026-10-12']],
 'Change Log':[[],[],[],H['Change Log'],['VAN-CHG-000001','2026-09-14 04:53 UTC','x','Scholars','VAN-S9001','Vital Status','','Living','test','','']]};
for(const t of ['Graduate Degrees','Publications','Authorship','Review Queue','Scholar Profile Submissions','Publication Geography Submissions'])T[t]=[[],[],[],['ID'],[]];
T['Graduate Degrees'][3]=['Degree ID'];T.Publications[3]=['Publication ID'];T.Authorship[3]=['Authorship ID'];T['Review Queue'][3]=['Candidate ID'];T['Scholar Profile Submissions'][3]=['Submission ID'];T['Publication Geography Submissions'][3]=['Submission ID'];
let sent=[];
function sheet(name){const v=T[name];const w=Math.max(...v.map(r=>r.length));return {getLastColumn:()=>w,getLastRow:()=>v.length,getSheetId:()=>Object.keys(T).indexOf(name),getRange:(r,c,nr,nc)=>({getDisplayValues:()=>v.slice(r-1,r-1+(nr||1)).map(row=>{const o=[];for(let j=0;j<(nc||1);j++)o.push(row[c-1+j]??'');return o;}),getFormula:()=>''})};}
const sb={Session:{getActiveUser:()=>({getEmail:()=>'owner@example.org'})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>({VANUATU_ROLES:JSON.stringify({'owner@example.org':'owner'}),VANUATU_WRITE_ENABLED:'true'})[k]||null})},
 SpreadsheetApp:{openById:()=>({getSheetByName:n=>T[n]?sheet(n):null})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Sheets:{Spreadsheets:{batchUpdate:b=>{sent=b.requests;}}},
 Utilities:{base64EncodeWebSafe:x=>Buffer.from(x).toString('base64url'),computeDigest:(_,s)=>require('crypto').createHash('sha256').update(String(s)).digest(),DigestAlgorithm:{SHA_256:1},getUuid:()=>'uuid',formatDate:(d,tz,f)=>{assert.equal(tz,'UTC');assert.equal(f,'yyyy-MM-dd HH:mm');return d.toISOString().slice(0,16).replace('T',' ');}},console};
vm.createContext(sb);vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/vanuatu-master-writeback.gs'),'utf8'),sb);sb.vanEnrichment_=()=>({});
const st=sb.getVanuatuAdminState();
assert.equal(st.tables.Scholars[0]['Vital Status'],'Living');            // new header read under the Admin's key
assert.equal(st.tables.Positions[0]['Current?'],'Former');
assert.equal(st.tables['Change Log'][0]['Changed At'],'2026-09-14 04:53 UTC');
// controlled values
assert.equal(sb.vanValidate_('Scholars','Vital Status','Living'),'Living');
assert.throws(()=>sb.vanValidate_('Scholars','Vital Status','Alive'),/Invalid controlled value/);
assert.equal(sb.vanValidate_('Positions','Current?','Unresolved'),'Unresolved');
assert.throws(()=>sb.vanValidate_('Positions','Current?','true'),/Invalid controlled value/);
// a Role Status save writes text into the Role Status column and a UTC audit row
const pos=st.tables.Positions[0];
const res=sb.saveVanuatuMaster({operationId:'op-aaaaaaaaaaaaaaaa',table:'Positions',id:'VAN-POS-90001',expectedVersion:pos._version,changes:{'Current?':'Current'},reason:'test'});
assert.equal(res.status,'saved-to-master');
const upd=sent.find(r=>r.updateCells);assert.equal(upd.updateCells.range.startColumnIndex,H.Positions.indexOf('Role Status'));assert.deepEqual(upd.updateCells.rows[0].values[0].userEnteredValue,{stringValue:'Current'});
const audit=sent.find(r=>r.appendCells).appendCells.rows[0].values;assert.match(audit[1].userEnteredValue.stringValue,/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
console.log('PASS Vanuatu Admin script reads and writes Living Status, Role Status and Changed At (UTC)');
