/** Vanuatu Admin service: native Google calls and authenticated POST requests
 * from the existing GitHub Pages Admin. Install the Sheets API service.
 * Owner: ronvave@hawaii.edu. Viewer passwords do not authorize writes.
 */
var vanHttpActor_ = null;
var VAN_SHEET_='1jfS6Yqyy559kLdoeKW4F4t8RhyBooXpCiwOMukxpPW0';
var VAN_PROVINCES_=['Torba','Sanma','Penama','Malampa','Shefa','Tafea'];
var VAN_KEYS_={'Scholars':'Scholar ID','Graduate Degrees':'Degree ID','Positions':'Position ID','Publications':'Publication ID','Authorship':'Authorship ID','Research Geography':'Geography Record ID','Review Queue':'Candidate ID','Scholar Profile Submissions':'Submission ID','Publication Geography Submissions':'Submission ID','Change Log':'Change ID','Public Export Config':'Field'};
// Schema alignment (Phase 2, 2026-10-21): Master headers use the shared reference-schema
// names; records keep their established keys so Admin screens, privacy deletions and
// field validation are unchanged. Physical column positions are read from row 4 as before.
var VAN_LEGACY_={
 'Scholars':{'Lineage / Provenance Notes':'Community / Ancestral Notes','Current Leadership Category':'Leadership Category','Current Leadership Level':'Leadership Level','ORCID':'ORCID / Researcher ID'},
 'Publications':{'Open Access URL':'Open Access URL / PDF','Keywords':'Author Keywords'},
 'Authorship':{'Reconciliation Notes':'Evidence / Notes'},
 'Positions':{'Title (verbatim)':'Title / Role','Employment Type':'Employment / Appointment Type','Last Verified':'Last Checked'},
 'Research Geography':{'Village / Site':'Village / Community'},
 'Review Queue':{'Submitted At':'Submitted / Found At'},
 'Scholar Profile Submissions':{'Submitter Email (private)':'Submitter Email'},
 'Publication Geography Submissions':{'Submitter Email (private)':'Submitter Email'}
};
var VAN_FIELDS_={
 'Scholars':['Scholar Name','Salutation','Family Name','Given Names','Gender','Year of Birth','Vital Status','Year of Death','Identity Verification Status','Identity Evidence','Identity Source URL','Identity Last Checked','Paternal Province','Paternal Island','Paternal Area Council / Locality','Paternal Village / Community','Maternal Province','Maternal Island','Maternal Area Council / Locality','Maternal Village / Community','Primary Discipline / Field','Current Title / Role','Current Institution','Institution Country','Current Department / Unit','Current Profile URL','ORCID / Researcher ID','Google Scholar URL','Public Display Approved','Review Status','Record Notes'],
 'Graduate Degrees':['Degree Level','Degree Name','Field / Discipline','Broad Discipline','Original University Name (O_Uni)','Canonical University Name (C_Uni)','University Country','Start Year','Completion Year','Completion Status','Thesis / Dissertation Title','Thesis URL / Handle','Repository URL','Supervisor(s)','Evidence','Source URL','Verification Status','Public Display Approved','Record Notes'],
 'Positions':['Title / Role','Institution','Department / Unit','Institution Country','Start Year','End Year','Current?','Leadership Category','Leadership Level','Profile URL','Evidence','Source URL','Verification Status','Public Display Approved','Record Notes']
};
var VAN_REVIEW_FIELDS_=['Salutation','Family Name','Given Names','Primary Discipline / Field','Current Title / Role','Current Institution','Institution Country','Current Department / Unit','Current Profile URL','ORCID / Researcher ID','Google Scholar URL','Paternal Province','Paternal Island','Paternal Area Council / Locality','Paternal Village / Community','Maternal Province','Maternal Island','Maternal Area Council / Locality','Maternal Village / Community'];
var VAN_ENUMS_={'Gender':['Female','Male','Non-binary','Another identity','Unknown / verify'],'Vital Status':['Alive','Deceased','Unknown / not checked'],'Identity Verification Status':['Verified','Probable','Unresolved','Excluded'],'Degree Level':["Master's",'PhD / Doctorate'],'Completion Status':['Completed','Ongoing','In progress','Withdrawn','Unknown / verify'],'Verification Status':['Verified','Probable','Unresolved','Excluded']};
function vanActor_(ownerOnly){
 if(vanHttpActor_)return vanHttpActor_;
 var email=String(Session.getActiveUser().getEmail()||'').toLowerCase().trim();
 if(!email)throw Error('Google identity unavailable. Sign in to the configured native Vanuatu deployment; anonymous and unsupported deployment modes are denied.');
 var roster=JSON.parse(PropertiesService.getScriptProperties().getProperty('VANUATU_ROLES')||'{}'),role=roster[email];
 if(['owner','reviewer'].indexOf(role)<0||ownerOnly&&role!=='owner')throw Error('This Google account is not authorized for this operation.');
 return {email:email,role:role};
}
function vanBook_(){var id=PropertiesService.getScriptProperties().getProperty('VANUATU_SPREADSHEET_ID')||VAN_SHEET_;if(id!==VAN_SHEET_)throw Error('Vanuatu spreadsheet scope mismatch.');return SpreadsheetApp.openById(id);}
function vanDigest_(r){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(r))).replace(/=+$/,'');}
function vanData_(name){
 if(!VAN_KEYS_[name])throw Error('Table is not an authorized Vanuatu entity.');
 var sheet=vanBook_().getSheetByName(name);if(!sheet)throw Error('Missing Vanuatu table: '+name);
 var width=sheet.getLastColumn(),last=sheet.getLastRow(),legacy=VAN_LEGACY_[name]||{},grid=sheet.getRange(4,1,Math.max(1,last-3),width).getDisplayValues(),headers=grid[0].map(function(h){return legacy[h]||h;}),seen={};
 headers.forEach(function(h){if(h&&seen[h])throw Error('Duplicate header: '+h);seen[h]=true;});
 var key=VAN_KEYS_[name],index=headers.indexOf(key);if(index<0)throw Error('Missing entity key header: '+key);
 var rows=last>4?grid.slice(1):[],ids={};
 var records=[];rows.forEach(function(row,i){if(!row[index])return;var id=row[index];if(ids[id]&&name!=='Public Export Config')throw Error('Duplicate entity key: '+id);ids[id]=true;var r={};headers.forEach(function(h,j){if(h)r[h]=row[j];});records.push({value:r,row:i+5});});
 return {sheet:sheet,headers:headers,records:records,key:key};
}
function vanRecord_(d,id){var matches=d.records.filter(function(r){return r.value[d.key]===id;});if(matches.length!==1)throw Error('Entity ID is missing or ambiguous: '+id);return matches[0];}
function doGet(){return vanJson_({service:'Vanuatu Admin',version:2,authentication:'Owner credential required for all data operations.'});}
function getVanuatuAdminState(){
 var actor=vanActor_(false),tables={};
 ['Scholars','Graduate Degrees','Positions','Publications','Authorship','Review Queue','Scholar Profile Submissions','Publication Geography Submissions','Change Log'].forEach(function(name){
  if(actor.role!=='owner'&&['Graduate Degrees','Positions','Publications','Authorship','Change Log'].indexOf(name)>=0){tables[name]=[];return;}
  var d=vanData_(name);
  // The Admin only displays the newest 100 Change Log entries and never edits them: send the newest 200 non-journal rows, without fingerprints.
  if(name==='Change Log'){tables[name]=d.records.map(function(e){return e.value;}).filter(function(r){return r['Entity Type']!=='Operation journal';}).slice(-200);return;}
  tables[name]=d.records.map(function(entry){var r=Object.assign({},entry.value),version=vanDigest_(entry.value);delete r['Scholar Share Token'];
   if(actor.role!=='owner'&&name==='Scholars'){var allowed=['Scholar ID','Scholar Name'];Object.keys(r).forEach(function(k){if(allowed.indexOf(k)<0)delete r[k];});}
   // Attachments and submitter contact are never enumerated by this UI.
   delete r['Submitter Email'];delete r['Attachments JSON'];r._version=version;return r;
  });
 });
 return {country:'Vanuatu',writeEnabled:PropertiesService.getScriptProperties().getProperty('VANUATU_WRITE_ENABLED')==='true',role:actor.role,actor:actor.email,tables:tables,enrichment:actor.role==='owner'?vanEnrichment_():{}};
}
function vanWriteEnabled_(){if(PropertiesService.getScriptProperties().getProperty('VANUATU_WRITE_ENABLED')!=='true')throw Error('Vanuatu writes are disabled. Owner activation is required.');}
function vanCell_(v){return {userEnteredValue:typeof v==='boolean'?{boolValue:v}:{stringValue:String(v==null?'':v)}};}
function vanUpdate_(d,row,field,value){var col=d.headers.indexOf(field);if(col<0)throw Error('Missing field header: '+field);if(d.sheet.getRange(row,col+1).getFormula())throw Error('Computed field is protected: '+field);return {updateCells:{range:{sheetId:d.sheet.getSheetId(),startRowIndex:row-1,endRowIndex:row,startColumnIndex:col,endColumnIndex:col+1},rows:[{values:[vanCell_(value)]}],fields:'userEnteredValue'}};}
function vanAudit_(actor,entity,id,field,before,after,reason){
 var d=vanData_('Change Log'),row={'Change ID':'VAN-CHG-'+Utilities.getUuid(),'Changed At':new Date().toISOString(),'Changed By':actor.email,'Entity Type':entity,'Entity ID':id,'Field / Action':field,'Old Value':String(before==null?'':before),'New Value':String(after==null?'':after),'Source / Reason':reason,'Approval / Notes':'Vanuatu native Admin'};
 return {appendCells:{sheetId:d.sheet.getSheetId(),rows:[{values:d.headers.map(function(h){return vanCell_(row[h]||'');})}],fields:'userEnteredValue'}};
}
function vanValidate_(table,field,value){
 if(!(VAN_FIELDS_[table]||[]).includes(field))throw Error('Read-only or unsupported field: '+field);
 var v=String(value==null?'':value).trim();if(v.length>6000)throw Error('Value too long: '+field);
 if(VAN_ENUMS_[field]&&v&&VAN_ENUMS_[field].indexOf(v)<0)throw Error('Invalid controlled value: '+field);
 if(/Province$/.test(field)&&v&&VAN_PROVINCES_.indexOf(v)<0)throw Error('Invalid province.');
 if(/Year/.test(field)&&v&&!/^\d{4}$/.test(v))throw Error('Year must be blank or four digits.');
 if(/URL|Handle/.test(field)&&v&&!/^https?:\/\/[^\s]+$/i.test(v))throw Error('URL must use http(s).');
 if(['Public Display Approved','Current?'].indexOf(field)>=0){if(!/^(true|false)$/i.test(v))throw Error('Approval flag must be true or false.');return /^true$/i.test(v);}
 return v;
}
function vanGeographyCheck_(record){
 var lookup=vanBook_().getSheetByName('Lookups');if(!lookup)throw Error('Missing geographic lookups.');var headers=lookup.getRange(4,1,1,lookup.getLastColumn()).getDisplayValues()[0],values=lookup.getRange(5,1,Math.max(1,lookup.getLastRow()-4),lookup.getLastColumn()).getDisplayValues();
 ['Paternal','Maternal'].forEach(function(side){var p=record[side+' Province'],local=record[side+' Area Council / Locality'];if(!p||!local)return;var match=values.filter(function(row){return String(row[headers.indexOf('Canonical Value')])===local&&/Area|Locality/i.test(row[headers.indexOf('Lookup Type')]);});if(match.length!==1||match[0][headers.indexOf('Parent Canonical Value')]!==p)throw Error('Locality/province relationship is unresolved. Verify the Lookups registry before saving.');});
 // Island is independent: never infer its parent from an area-council name.
}
function vanJournalSheet_(){var d=vanData_('Change Log');return d.records;}
function vanReplay_(operationId,payload){
 if(!/^[\w-]{16,80}$/.test(operationId||''))throw Error('A valid operation ID is required.');var rows=vanJournalSheet_(),id='VAN-OP-'+operationId,found=rows.filter(function(r){return r.value['Change ID']===id;});
 if(found.length){var r=found[0].value;if(r['Old Value']!==vanDigest_(payload))throw Error('Operation ID reused with a different request.');return JSON.parse(r['New Value']);}return null;
}
function vanJournalRequest_(actor,op,payload,result){var d=vanData_('Change Log'),r={'Change ID':'VAN-OP-'+op,'Changed At':new Date().toISOString(),'Changed By':actor.email,'Entity Type':'Operation journal','Entity ID':op,'Field / Action':'Completed operation','Old Value':vanDigest_(payload),'New Value':JSON.stringify(result),'Source / Reason':'Idempotent native Vanuatu write','Approval / Notes':'Private; never export'};return {appendCells:{sheetId:d.sheet.getSheetId(),rows:[{values:d.headers.map(function(h){return vanCell_(r[h]||'');})}],fields:'userEnteredValue'}};}
function saveVanuatuMaster(payload){
 var actor=vanActor_(true);vanWriteEnabled_();var lock=LockService.getScriptLock();lock.waitLock(30000);
 try{var prior=vanReplay_(payload.operationId,payload);if(prior)return prior;var d=vanData_(payload.table),r=vanRecord_(d,payload.id);if(vanDigest_(r.value)!==payload.expectedVersion)throw Error('Conflict: this record changed. Reload before editing.');
  var reason=String(payload.reason||'').trim();if(!reason)throw Error('Evidence/reason is required.');var keys=Object.keys(payload.changes||{});if(!keys.length||keys.length>40)throw Error('Invalid change set.');var merged=Object.assign({},r.value),requests=[];
  keys.forEach(function(field){if(/Status|Approved|Year of Death|Scholar Name/.test(field)&&payload.confirmedStatus!==true)throw Error('Explicit status/name confirmation required.');var value=vanValidate_(payload.table,field,payload.changes[field]);merged[field]=value;requests.push(vanUpdate_(d,r.row,field,value));requests.push(vanAudit_(actor,payload.table,payload.id,field,r.value[field],value,reason));});
  if(payload.table==='Scholars'){vanGeographyCheck_(merged);if(merged['Vital Status']==='Alive'&&String(merged['Year of Death']||''))throw Error('An alive scholar cannot have a year of death.');if(merged['Identity Verification Status']==='Verified'&&(!merged['Identity Evidence']||!merged['Identity Source URL']))throw Error('Verified identity requires person-specific evidence and a source URL.');}
  var result={status:'saved-to-master',message:'Saved to Vanuatu Master. Public snapshot refresh is still required.'};requests.push(vanJournalRequest_(actor,payload.operationId,payload,result));Sheets.Spreadsheets.batchUpdate({requests:requests},VAN_SHEET_);return result;
 }finally{lock.releaseLock();}
}
function reviewVanuatuProposal(payload){
 var actor=vanActor_(false);vanWriteEnabled_();if(['Scholar Profile Submissions','Publication Geography Submissions','Review Queue'].indexOf(payload.table)<0)throw Error('Unsupported review queue.');var lock=LockService.getScriptLock();lock.waitLock(30000);
 try{var prior=vanReplay_(payload.operationId,payload);if(prior)return prior;var d=vanData_(payload.table),r=vanRecord_(d,payload.id);if(vanDigest_(r.value)!==payload.expectedVersion||r.value.Status!=='Pending')throw Error('Proposal changed or is no longer pending. Reload it.');var requests=[],remaining={},status='Rejected';
  if(payload.action==='approve'){
   if(payload.table!=='Scholar Profile Submissions')throw Error('Candidate/geography approvals require owner evidence review in the Master. Automated approval is disabled.');
   var fields=payload.fields||[];if(!fields.length)throw Error('Select at least one field.');var proposed=JSON.parse(r.value['Changed Fields JSON']||'{}'),sd=vanData_('Scholars'),scholar=vanRecord_(sd,r.value['Scholar ID']),merged=Object.assign({},scholar.value);remaining=Object.assign({},proposed);
   fields.forEach(function(field){if(VAN_REVIEW_FIELDS_.indexOf(field)<0)throw Error('Reviewer cannot approve this field: '+field);if(!Object.prototype.hasOwnProperty.call(proposed,field))throw Error('Field not in proposal.');var change=proposed[field];if(!change||typeof change!=='object'||!Object.prototype.hasOwnProperty.call(change,'current')||!Object.prototype.hasOwnProperty.call(change,'proposed'))throw Error('Proposal lacks current/proposed conflict evidence. Owner reconciliation required.');if(String(scholar.value[field]||'')!==String(change.current||''))throw Error('Conflict: Master value changed for '+field);var value=vanValidate_('Scholars',field,change.proposed);merged[field]=value;requests.push(vanUpdate_(sd,scholar.row,field,value));requests.push(vanAudit_(actor,'Scholars',r.value['Scholar ID'],field,scholar.value[field],value,String(payload.notes||'Reviewed submission')));delete remaining[field];});vanGeographyCheck_(merged);status=Object.keys(remaining).length?'Pending':'Approved';requests.push(vanUpdate_(d,r.row,'Changed Fields JSON',JSON.stringify(remaining)));
  }else if(payload.action!=='reject')throw Error('Unknown review decision.');
  requests.push(vanUpdate_(d,r.row,'Status',status));['Reviewed By','Reviewed At','Review Notes','Resolution'].forEach(function(field){if(d.headers.indexOf(field)>=0)requests.push(vanUpdate_(d,r.row,field,field==='Reviewed By'?actor.email:field==='Reviewed At'?new Date().toISOString():field==='Review Notes'?String(payload.notes||''):status==='Pending'?'Selected fields approved; remaining proposal pending':payload.action));});requests.push(vanAudit_(actor,payload.table,payload.id,'Review decision',r.value.Status,status,String(payload.notes||'Explicit review decision')));
  var result={status:'saved-to-master',message:'Review saved: '+status+'. Approved changes await public snapshot refresh.'};requests.push(vanJournalRequest_(actor,payload.operationId,payload,result));Sheets.Spreadsheets.batchUpdate({requests:requests},VAN_SHEET_);return result;
 }finally{lock.releaseLock();}
}
function vanEnrichment_(){var id=PropertiesService.getScriptProperties().getProperty('VANUATU_ENRICHMENT_FILE_ID');if(!id)return {};var doc=JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()),out=doc.scholars||{};Object.keys(out).forEach(function(k){out[k]._version=vanDigest_(out[k]);});return out;}
function saveVanuatuEnrichment(payload){
 var actor=vanActor_(true);vanWriteEnabled_();var lock=LockService.getScriptLock();lock.waitLock(30000);
 try{vanRecord_(vanData_('Scholars'),payload.scholarId);var id=PropertiesService.getScriptProperties().getProperty('VANUATU_ENRICHMENT_FILE_ID');if(!id)throw Error('Private Vanuatu enrichment file is not configured.');var file=DriveApp.getFileById(id),doc=JSON.parse(file.getBlob().getDataAsString());
  if(!/^[\w-]{16,80}$/.test(payload.operationId||''))throw Error('Operation ID is required.');doc.operations=doc.operations||{};var operation=doc.operations[payload.operationId];if(operation){if(operation.digest!==vanDigest_(payload))throw Error('Operation ID reused with another request.');return operation.result;}
  doc.scholars=doc.scholars||{};var old=doc.scholars[payload.scholarId]||{};if((Object.keys(old).length?vanDigest_(old):'')!==payload.expectedVersion)throw Error('Enrichment changed. Reload before saving.');
  if(payload.photo)vanValidatePhoto_(payload.photo);if(String(payload.summary||'').length>12000)throw Error('Summary is too long.');if(!String(payload.reason||'').trim())throw Error('Evidence/reason is required.');
  ['institutionUrl','departmentUrl'].forEach(function(k){if(payload[k]&&!/^https:\/\/[^\s]+$/.test(payload[k]))throw Error(k+' must use HTTPS.');});
  if(payload.keywords&&(!Array.isArray(payload.keywords)||payload.keywords.length>50||payload.keywords.some(function(v){return typeof v!=='string'||v.length>200;})))throw Error('Invalid keywords.');
  if(payload.sources&&(!Array.isArray(payload.sources)||payload.sources.length>50||payload.sources.some(function(v){return !(typeof v==='string'&&/^https?:\/\/[^\s]+$/.test(v)||v&&typeof v==='object'&&typeof v.url==='string'&&/^https?:\/\/[^\s]+$/.test(v.url)&&String(v.title||'').length<=300);})))throw Error('Sources must be HTTP(S) URLs.');
  if(String(payload.sector||'').length>200)throw Error('Sector is too long.');
  // Merge freshest document, retaining every other scholar and supplementary field.
  doc.scholars[payload.scholarId]=Object.assign({},old,{photo:String(payload.photo||''),summary:String(payload.summary||''),keywords:payload.keywords||[],sources:payload.sources||[],sector:String(payload.sector||''),institutionUrl:String(payload.institutionUrl||''),departmentUrl:String(payload.departmentUrl||''),approved:true,updatedAt:new Date().toISOString(),updatedBy:actor.email});doc.revision=Utilities.getUuid();
  var result={status:'sidecar-saved',message:'Approved enrichment saved privately. Export/publication still required.'};doc.operations[payload.operationId]={digest:vanDigest_(payload),result:result};file.setContent(JSON.stringify(doc));
  // Drive and Sheets cannot be one atomic transaction. Do not claim otherwise.
  try{Sheets.Spreadsheets.batchUpdate({requests:[vanAudit_(actor,'Admin enrichment',payload.scholarId,'Approved photo/summary',old.summary||'',payload.summary||'',payload.reason)]},VAN_SHEET_);}catch(e){result={status:'sidecar-saved-audit-pending',message:'Sidecar saved; audit write failed. Owner reconciliation required before publication.'};doc.operations[payload.operationId].result=result;file.setContent(JSON.stringify(doc));}
  return result;
 }finally{lock.releaseLock();}
}

/** HTTP bridge for the existing GitHub Pages Admin layout. The owner secret is
 * kept in Script Properties and entered only in the Admin Data source form.
 * Viewing passwords never authorize a write. Credentials are POSTed, not URLs.
 */
function doPost(e) {
  try {
    var text=String(e&&e.postData&&e.postData.contents||'');
    if(text.length>900000)throw Error('Request too large.');
    var request=JSON.parse(text),props=PropertiesService.getScriptProperties();
    var expected=props.getProperty('SHARED_SECRET')||'',received=String(request.secret||'');
    var diff=expected.length^received.length;
    for(var i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^(received.charCodeAt(i)||0);
    if(expected.length<32||diff||!Number.isFinite(request.clientTs)||Math.abs(Date.now()-request.clientTs)>300000)throw Error('Owner authentication failed.');
    vanHttpActor_={email:'ronvave@hawaii.edu',role:'owner'};
    var routes={getVanuatuAdminState:getVanuatuAdminState,saveVanuatuMaster:saveVanuatuMaster,saveVanuatuEnrichment:saveVanuatuEnrichment,reviewVanuatuProposal:reviewVanuatuProposal,refreshVanuatuSnapshot:refreshVanuatuSnapshot};
    if(!Object.prototype.hasOwnProperty.call(routes,request.method))throw Error('Unsupported Admin operation.');
    return vanJson_({ok:true,result:routes[request.method](request.payload)});
  }catch(error){return vanJson_({ok:false,error:String(error.message||error)});}
  finally{vanHttpActor_=null;}
}
function vanJson_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function vanValidatePhoto_(photo){
  if(/^https:\/\/[^\s]+$/.test(photo))return photo;
  if(typeof photo!=='string'||photo.length>700000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))throw Error('Photo must be an HTTPS URL or uploaded JPEG (maximum 500 KB).');
  var bytes=Utilities.base64Decode(photo.split(',')[1]);
  if(bytes.length>512000||bytes.length<4||(bytes[0]&255)!==255||(bytes[1]&255)!==216||(bytes[bytes.length-2]&255)!==255||(bytes[bytes.length-1]&255)!==217)throw Error('Invalid JPEG photo.');
  return photo;
}
function refreshVanuatuSnapshot(){
  vanActor_(true);vanWriteEnabled_();
  if(typeof dispatchMasterRefreshFromServer_!=='function')throw Error('Vanuatu refresh helper is missing.');
  var result=dispatchMasterRefreshFromServer_();
  if(!result.ok)throw Error(result.message);
  return {status:'refresh-dispatched',message:'Vanuatu snapshot refresh queued. Check GitHub Actions for completion.'};
}
/** Run manually as the owner after adding the Sheets API service. Does not
 * publish data, install triggers, grant sharing access, or enable writes.
 */
function setupVanuatuAdmin(){
  var email=String(Session.getActiveUser().getEmail()||'').toLowerCase();
  if(email!=='ronvave@hawaii.edu')throw Error('Run setup using ronvave@hawaii.edu.');
  var props=PropertiesService.getScriptProperties();
  vanBook_();
  props.setProperty('VANUATU_ROLES',JSON.stringify({'ronvave@hawaii.edu':'owner'}));
  if(!props.getProperty('SHARED_SECRET'))props.setProperty('SHARED_SECRET',Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''));
  if(!props.getProperty('VANUATU_WRITE_ENABLED'))props.setProperty('VANUATU_WRITE_ENABLED','false');
  if(!props.getProperty('VANUATU_ENRICHMENT_FILE_ID')){
    var file=DriveApp.createFile('Vanuatu Admin enrichment.json',JSON.stringify({version:1,scholars:{}}),MimeType.PLAIN_TEXT);
    props.setProperty('VANUATU_ENRICHMENT_FILE_ID',file.getId());
  }
  Logger.log('Setup saved. Writes remain at their existing setting. Credentials are in Script Properties, not this log.');
  Logger.log('Enrichment file ID: '+props.getProperty('VANUATU_ENRICHMENT_FILE_ID'));
}
