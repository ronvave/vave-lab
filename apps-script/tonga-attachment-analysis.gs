/** Private attachment proposals. Only authenticated Tonga reviewers may call these routes.
 * Extraction is staged per file; no Master writes occur until explicit selected approval.
 * PDF text is extracted locally by the review browser. Bibliographies are parsed from Drive.
 */
function tongaAnalysisKey_(o){return 'TONGA_ANALYSIS_'+o['Submission ID'];}
function tongaAnalysisLoad_(o){
 var id=PropertiesService.getScriptProperties().getProperty(tongaAnalysisKey_(o));if(!id)return null;
 var envelope=JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
 if(envelope.signature!==tongaPlanSignature_(envelope.data)||envelope.data.submissionId!==o['Submission ID'])throw Error('Attachment analysis integrity check failed');return envelope.data;
}
function tongaAnalysisSave_(o,a){
 a.updatedAt=tongaNow_();a.revision=(a.revision||0)+1;
 var text=JSON.stringify({data:a,signature:tongaPlanSignature_(a)});if(text.length>1500000)throw Error('Analysis too large; split attachments');
 var props=PropertiesService.getScriptProperties(),id=props.getProperty(tongaAnalysisKey_(o));
 if(id)DriveApp.getFileById(id).setContent(text);else{
  var folder=props.getProperty('SCHOLAR_SUBMISSION_FOLDER_ID');if(!folder)throw Error('Private submission folder is not configured');
  var f=DriveApp.getFolderById(folder).createFile('Analysis-'+o['Submission ID']+'.json',text,'application/json');props.setProperty(tongaAnalysisKey_(o),f.getId());
 }
 return a;
}
function tongaReadAnalysis_(body){var o=findScholarSubmission_(geoSs_(),String(body.submissionId||''));if(!o)throw Error('Submission not found');return jsonOut_({status:'ok',analysis:tongaAnalysisLoad_(o)});}
function tongaAnalysisFiles_(o){var files=parseJsonObject_(o['Attachments JSON']);return Array.isArray(files)?files:[];}
function tongaAnalysisObjects_(ss,name){var t=tongaTable_(ss,name);return t.rows.map(function(r,i){var o={_row:i+5};t.headers.forEach(function(h,j){if(h)o[h]=r[j]||'';});return o;});}
function tongaAnalysisModel_(ss,o){return {publications:tongaAnalysisObjects_(ss,'Publications'),authorship:tongaAnalysisObjects_(ss,'Authorship'),scholar:tongaAnalysisObjects_(ss,'Scholars').filter(function(s){return s['Scholar ID']===o['Scholar ID'];})[0]};}
function tongaAnalysisMatch_(r,model){
 var p=TongaAttachmentParser,d=p.doi(r.doi),title=p.norm(r.title);
 var matches=model.publications.filter(function(x){return d&&p.doi(x.DOI)===d;});
 if(!matches.length)matches=model.publications.filter(function(x){return title&&p.norm(x.Title)===title&&String(x.Year)===String(r.year);});
 if(matches.length>1)return {reason:'Multiple matching Master publications. Resolve the duplicate records first.'};
 if(matches.length===1){var x=matches[0];if(d&&p.doi(x.DOI)&&d!==p.doi(x.DOI))return {reason:'Title and year match, but DOI conflicts. Inspect both records.'};return {publication:x};}
 var near=model.publications.filter(function(x){var t=p.norm(x.Title);return t===title||(title.length>24&&t.length>24&&(t.indexOf(title)>=0||title.indexOf(t)>=0));});
 return near.length?{reason:'Possible duplicate: '+near.slice(0,3).map(function(x){return x.Title+' ('+x.Year+')';}).join('; ')}:{};
}
function tongaAnalysisAuthor_(r,scholar){
 var p=TongaAttachmentParser,family=p.norm(scholar&&scholar['Family Name']),given=p.norm(scholar&&scholar['Given Names']),hits=[];
 r.authors.forEach(function(author,i){var parts=author.split(','),last=parts.length>1?parts[0]:author.split(/\s+/).slice(-1)[0],first=parts.length>1?parts.slice(1).join(' '):author.split(/\s+/).slice(0,-1).join(' ');
  if(family&&p.norm(last)===family&&p.norm(first)&&given&&p.norm(first)[0]===given[0])hits.push(i+1);
 });return hits.length===1?hits[0]:0;
}
function tongaAnalysisPublication_(r,model,o){
 var match=tongaAnalysisMatch_(r,model),pub=match.publication,pid=pub&&pub['Publication ID / BibTeX Key'],linked=pid&&model.authorship.some(function(a){return a['Scholar ID']===o['Scholar ID']&&a['Publication ID / BibTeX Key']===pid;});
 var values={'Entry Type':r.type,'Publication Type':r.publicationType,Title:r.title,Year:r.year,'Journal / Book Title':r.venue,'Publisher / Institution / School':r.publisher,DOI:r.doi,URL:r.url},updates=[];
 if(pub)Object.keys(values).forEach(function(k){
  // A BibTeX entry type is not evidence for recategorising a verified editorial/report.
  if((k==='Publication Type'||k==='Entry Type')&&pub[k])return;
  var same=['Title','Journal / Book Title','Publisher / Institution / School'].indexOf(k)>=0?TongaAttachmentParser.norm(pub[k])===TongaAttachmentParser.norm(values[k]):k==='DOI'?TongaAttachmentParser.doi(pub[k])===TongaAttachmentParser.doi(values[k]):String(pub[k]||'')===String(values[k]);
  if(values[k]&&!same)updates.push({field:k,current:pub[k]||'',value:values[k]});
 });
 var issue=match.reason||(!r.title?'Missing title':!r.year?'Missing publication year; unpublished/in-press work needs manual review':!r.publicationType?'Unrecognized publication type; review before import':'');
 if(!issue&&updates.some(function(u){return String(u.current).trim()!=='';}))issue='Differs from existing Master metadata. Verify the original sources before accepting a replacement.';
 return {kind:'publication',record:r,publicationId:pid||'',authorPosition:tongaAnalysisAuthor_(r,model.scholar),linked:!!linked,updates:updates,state:issue?'needs_review':linked&&!updates.length?'existing':'pending',reason:issue,current:pub?{title:pub.Title,year:pub.Year,doi:pub.DOI||'',linked:!!linked}:'Not in Master',label:pub?(linked?'Update publication metadata':'Link existing publication to scholar'):'Add publication and authorship'};
}
function tongaAnalysisCv_(ss,o,proposal){
 if(proposal.key==='institution')proposal.value=String(proposal.value).split(/\s{2,}/)[0].trim();
 var fields={};fields[proposal.key]=proposal.value;var fake={};Object.keys(o).forEach(function(k){fake[k]=o[k];});fake['Submitted Fields JSON']=JSON.stringify(fields);
 var changes=buildScholarSubmissionChanges_(ss,fake),c=changes.filter(function(x){return x.key===proposal.key;})[0];
 return {kind:'profile',key:proposal.key,value:proposal.value,source:proposal.source,evidence:proposal.evidence,label:c?c.label:proposal.key,change:c||null,state:c?(c.writable&&!String(c.currentValue||'').trim()?'pending':'needs_review'):'existing',reason:c?c.reason||'Verify the extracted value against the source page':'Already matches the Master'};
}
function tongaAnalyseAttachment_(body){return tongaWithSubmission_(body,function(ss,o){
 var f=tongaAnalysisFiles_(o).filter(function(x){return x.fileId===body.fileId;})[0];if(!f)throw Error('Attachment not in submission');
 var a=tongaAnalysisLoad_(o)||{version:1,submissionId:o['Submission ID'],scholarId:o['Scholar ID'],files:[],items:[],revision:0};
 if(a.files.some(function(x){return x.fileId===f.fileId;}))return jsonOut_({status:'ok',analysis:a,alreadyAnalysed:true});
 var start=a.items.length,summary={fileId:f.fileId,name:f.name,status:'analysed',warnings:[]};
 var file=DriveApp.getFileById(f.fileId),blob=file.getBlob();summary.fingerprint=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,blob.getBytes()));
 if(/\.(bib|ris|enw)$/i.test(f.name)){
  var parsed=TongaAttachmentParser.bibliography(blob.getDataAsString('UTF-8'),f.name),model=tongaAnalysisModel_(ss,o),seen={};summary.records=parsed.records.length;summary.warnings=parsed.warnings;
  parsed.records.forEach(function(r){var key=TongaAttachmentParser.doi(r.doi)||TongaAttachmentParser.norm(r.title)+'|'+r.year,item=tongaAnalysisPublication_(r,model,o);
   var earlier=a.items.find(function(x){return x.kind==='publication'&&(TongaAttachmentParser.doi(x.record.doi)||TongaAttachmentParser.norm(x.record.title)+'|'+x.record.year)===key;});
   if(seen[key]||earlier){item.state='duplicate';item.reason='Duplicate of another uploaded record; import only once.';}seen[key]=true;a.items.push(item);
  });
 }else if(/\.pdf$/i.test(f.name)&&f.field==='cv'){
  var pages=body.pages;if(!Array.isArray(pages)||!pages.length||pages.length>100)throw Error('PDF page text is required (maximum 100 pages)');
  if(JSON.stringify(pages).length>500000)throw Error('CV text exceeds analysis limit');
  pages=pages.map(function(p,i){if(p.page!==i+1||typeof p.text!=='string')throw Error('Invalid PDF page sequence');return {page:p.page,text:p.text};});
  if(body.fingerprint!==summary.fingerprint)throw Error('Attachment changed. Download and analyse it again.');
  var result=TongaAttachmentParser.cv(pages);summary.pages=pages.length;summary.sections=result.sections;
  summary.warnings.push('PDF extraction may omit text or mix columns. Verify proposals against the original. Names, private contact details and personal activities are not proposed for publication.');
  if(pages.some(function(p){return p.text.trim().length<30;}))summary.warnings.push('Some pages contain little readable text. Scanned pages need manual review; OCR is not performed.');
  result.proposals.forEach(function(p){a.items.push(tongaAnalysisCv_(ss,o,p));});
 }else{summary.status='manual';summary.warnings.push('This attachment format needs manual review. Automatic analysis supports CV PDFs and BibTeX, RIS or EndNote text exports.');}
 for(var i=start;i<a.items.length;i++){a.items[i].id=f.fileId+':'+(i-start+1);a.items[i].fileId=f.fileId;a.items[i].fileName=f.name;}
 a.files.push(summary);
 // Cross-reference bibliography records with private CV pages without inferring missing metadata.
 a.items.filter(function(i){return i.kind==='publication';}).forEach(function(item){item.cvEvidence=[];a.files.forEach(function(f){(f.sections||[]).forEach(function(page){var d=TongaAttachmentParser.doi(item.record.doi),text=page.excerpt;if((d&&text.toLowerCase().indexOf(d)>=0)||(item.record.title.length>30&&TongaAttachmentParser.norm(text).indexOf(TongaAttachmentParser.norm(item.record.title))>=0)){item.cvEvidence.push({fileName:f.name,page:page.page,excerpt:text});}});});});
 return jsonOut_({status:'ok',analysis:tongaAnalysisSave_(o,a)});
});}
var TONGA_CV_KEYS=['title','institution','department','masters_university','masters_country','masters_year','masters_thesis_url','phd_university','phd_country','phd_year','phd_thesis_url'];
function tongaEditAnalysis_(body){return tongaWithSubmission_(body,function(ss,o){
 var a=tongaAnalysisLoad_(o);if(!a||a.revision!==body.revision)throw Error('Analysis changed; reload before editing');
 var item=a.items.find(function(x){return x.id===body.itemId;});
 if(item&&['pending','needs_review','existing'].indexOf(item.state)<0)throw Error('This item already has a final outcome');
 if(body.kind==='profile'){
  var file=a.files.find(function(f){return f.fileId===body.fileId&&f.pages;});if(!file)throw Error('Analysed CV required');
  if(TONGA_CV_KEYS.indexOf(body.key)<0)throw Error('Unsupported CV field');
  var page=file.sections.find(function(s){return s.page===Number(body.page);});if(!page)throw Error('Choose a valid source page');
  var value=String(body.value||'').trim();if(!value||value.length>500||/^[=+@]/.test(value))throw Error('Enter a valid non-empty proposed value');
  var proposal=tongaAnalysisCv_(ss,o,{key:body.key,value:value,source:'CV page '+page.page,evidence:page.excerpt});
  if(item){if(item.kind!=='profile'||item.fileId!==file.fileId)throw Error('Proposal does not belong to this CV');Object.keys(proposal).forEach(function(k){item[k]=proposal[k];});}
  else {item=proposal;item.id=file.fileId+':manual:'+Utilities.getUuid();item.fileId=file.fileId;item.fileName=file.name;a.items.push(item);}
 }else{
  if(!item||item.kind!=='publication')throw Error('Publication proposal not found');
  var r=JSON.parse(JSON.stringify(item.record));['title','year','doi','url','venue','publisher'].forEach(function(k){if(body.record&&typeof body.record[k]==='string'){if(body.record[k].length>1000)throw Error('Value too long');r[k]=body.record[k].trim();}});
  r.doi=TongaAttachmentParser.doi(r.doi);var fresh=tongaAnalysisPublication_(r,tongaAnalysisModel_(ss,o),o);
  var position=Number(body.authorPosition);if(!Number.isInteger(position)||position<1||position>r.authors.length)throw Error('Select this scholar’s author position from the source authors');
  fresh.authorPosition=position;Object.keys(fresh).forEach(function(k){item[k]=fresh[k];});
 }
 item.editedBy=ACTOR_LABEL;item.editedAt=tongaNow_();return jsonOut_({status:'ok',analysis:tongaAnalysisSave_(o,a)});
});}
function tongaAnalysisLiteralRow_(table,values){return table.headers.map(function(h){return tongaLiteral_(values[h]===undefined?'':values[h]);});}
function tongaAnalysisAppend_(table,values){var row=table.sheet.getLastRow()+1;if(row>table.sheet.getMaxRows())table.sheet.insertRowsAfter(table.sheet.getMaxRows(),1);table.sheet.getRange(row,1,1,table.headers.length).setValues([tongaAnalysisLiteralRow_(table,values)]);return row;}
function tongaAnalysisPublicationWrite_(ss,o,item){
 var r=item.record;if(!r.title||r.title.length>1000||!/^\d{4}$/.test(r.year)||!r.publicationType)throw Error('Publication title, year and recognized type required');
 if(r.doi&&!/^10\.\d{4,9}\/\S+$/.test(r.doi))throw Error('Invalid DOI');
 if(r.url&&!/^https?:\/\/\S+$/i.test(r.url))throw Error('Invalid publication URL');
 var pos=Number(item.authorPosition);if(!Number.isInteger(pos)||pos<1||pos>r.authors.length)throw Error('Confirm the scholar’s author position before importing');
 var model=tongaAnalysisModel_(ss,o),match=tongaAnalysisMatch_(r,model),pub=match.publication;
 if(match.reason)throw Error(match.reason);
 if(item.publicationId&&(!pub||pub['Publication ID / BibTeX Key']!==item.publicationId))throw Error('Publication match changed; refresh this proposal');
 var t=tongaTable_(ss,'Publications'),at=tongaTable_(ss,'Authorship');
 ['Publication ID / BibTeX Key','Title','Year','Publication Type','DOI','URL','Record Source'].forEach(function(h){if(t.headers.indexOf(h)<0)throw Error('Master publication header missing: '+h);});
 ['Authorship ID','Scholar ID','Publication ID / BibTeX Key','Author Name as Recorded','Author Position','Is First Author?'].forEach(function(h){if(at.headers.indexOf(h)<0)throw Error('Master authorship header missing: '+h);});
 var pid=pub&&pub['Publication ID / BibTeX Key'],provenance='Approved attachment '+o['Submission ID']+' / '+item.record.source;
 if(pub){
  (item.updates||[]).forEach(function(u){if(['Entry Type','Publication Type','Title','Year','Journal / Book Title','Publisher / Institution / School','DOI','URL'].indexOf(u.field)<0)throw Error('Unsupported publication field');if(String(pub[u.field]||'')!==String(u.current)&&String(pub[u.field]||'')!==String(u.value))throw Error('Master changed for '+u.field+'; refresh this proposal');var cell=t.sheet.getRange(pub._row,t.headers.indexOf(u.field)+1);if(cell.getFormula())throw Error('Cannot replace a computed publication field');});
 }else{
  var key=TongaAttachmentParser.doi(r.doi)||TongaAttachmentParser.norm(r.title)+'|'+r.year;
  pid='TNG-ATT-'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,key)).replace(/=+$/,'').slice(0,24);
  if(model.publications.some(function(p){return p['Publication ID / BibTeX Key']===pid;}))throw Error('Publication identifier collision; manual review required');
 }
 // Persist the intended publication ID before a write, allowing safe retry after interruption.
 item.targetPublicationId=pid;
 if(!pub){
  var vals={'Publication ID / BibTeX Key':pid,'Entry Type':r.type,'Publication Type':r.publicationType,Title:r.title,Year:r.year,'Journal / Book Title':r.venue,'Publisher / Institution / School':r.publisher,DOI:r.doi,URL:r.url,'Record Source':provenance,'Bibliographic Lead Author':r.authors[0]||'','Bibliographic Author Count':r.authors.length,'Deduplication Key':TongaAttachmentParser.doi(r.doi)||TongaAttachmentParser.norm(r.title)+'|'+r.year};
  tongaAnalysisAppend_(t,vals);appendChangeLog_(ss,'Publications',o['Scholar ID'],'Publication added: '+pid,'',r.title+' ('+r.year+') — '+provenance);
 }else (item.updates||[]).forEach(function(u){if(String(pub[u.field]||'')===String(u.value))return;t.sheet.getRange(pub._row,t.headers.indexOf(u.field)+1).setValue(tongaLiteral_(u.value));appendChangeLog_(ss,'Publications',o['Scholar ID'],u.field+' — '+pid,pub[u.field]||'',u.value);});
 if(!model.authorship.some(function(x){return x['Scholar ID']===o['Scholar ID']&&x['Publication ID / BibTeX Key']===pid;})){
  var auth={'Authorship ID':'TNG-ATT-A-'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,o['Scholar ID']+'|'+pid)).replace(/=+$/,'').slice(0,24),'Scholar ID':o['Scholar ID'],'Scholar Name':model.scholar['Scholar Name'],'Publication ID / BibTeX Key':pid,'Author Name as Recorded':r.authors[pos-1],'Author Position':pos,'Is First Author?':pos===1?'Yes':'No'};
  tongaAnalysisAppend_(at,auth);appendChangeLog_(ss,'Authorship',o['Scholar ID'],'Publication linked: '+pid,'',r.authors[pos-1]+' — '+provenance);
 }
 return pid;
}
function tongaApproveAnalysis_(body){return tongaWithSubmission_(body,function(ss,o){
 TONGA_READ_TABLES=null;var a=tongaAnalysisLoad_(o);if(!a)throw Error('Analyse attachments first');if(['approve','dismiss'].indexOf(body.decision)<0)throw Error('Invalid decision');
 if(a.revision!==body.revision)throw Error('Analysis changed; reload before approving');
 if(!Array.isArray(body.itemIds)||!body.itemIds.length||body.itemIds.length>10)throw Error('Select 1–10 proposals per request');
 var results=[],checkedFiles={};
 body.itemIds.forEach(function(id){var item=a.items.find(function(x){return x.id===id;});if(!item)throw Error('Unknown proposal');if(item.state==='applied'||item.state==='dismissed')return;
  if(['pending','needs_review'].indexOf(item.state)<0)throw Error('Item cannot be approved');
  try{
   if(!checkedFiles[item.fileId]&&body.decision==='approve'){var source=a.files.find(function(f){return f.fileId===item.fileId;});if(!source||!tongaAnalysisFiles_(o).some(function(f){return f.fileId===item.fileId;}))throw Error('Source attachment not found');var hash=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,DriveApp.getFileById(item.fileId).getBlob().getBytes()));if(hash!==source.fingerprint)throw Error('Original attachment changed; manual review required');checkedFiles[item.fileId]=true;}
   if(body.decision==='dismiss'){item.state='dismissed';item.reviewNote=String(body.note||'Not accepted by reviewer').slice(0,1000);}
   else{
    if(item.kind==='profile'){
     var refreshed=tongaAnalysisCv_(ss,o,{key:item.key,value:item.value,source:item.source,evidence:item.evidence});
     if(refreshed.state!=='existing'){
      if(!refreshed.change||!refreshed.change.writable||!item.change||normalizeForCompare_(refreshed.change.currentValue)!==normalizeForCompare_(item.change.currentValue))throw Error('Master changed or field needs manual review; edit/refresh proposal');
      var c=refreshed.change,result=applyOneChange_(ss,{worksheet:c.worksheet,scholarId:o['Scholar ID'],rowNumber:c.rowNumber,field:c.field,oldValue:item.change.currentValue,newValue:item.value},false);if(['ok','already_satisfied'].indexOf(result.status)<0)throw Error('Write validation failed: '+result.status);
     }
    }else {item.resultPublicationId=tongaAnalysisPublicationWrite_(ss,o,item);}
    item.state='applied';
   }
   item.reviewedBy=ACTOR_LABEL;item.reviewedAt=tongaNow_();delete item.error;tongaAnalysisSave_(o,a);results.push({id:id,status:'ok'});
  }catch(e){item.error=String(e.message||e);tongaAnalysisSave_(o,a);results.push({id:id,status:'error',error:item.error});}
 });return jsonOut_({status:'ok',analysis:a,results:results});
});}

function tongaRefreshAnalysis_(body){return tongaWithSubmission_(body,function(ss,o){
 var a=tongaAnalysisLoad_(o);if(!a)throw Error('Analyse attachments first');if(a.revision!==body.revision)throw Error('Analysis changed; reload first');var model=tongaAnalysisModel_(ss,o);
 a.items.forEach(function(item){if(['applied','dismissed','duplicate'].indexOf(item.state)>=0)return;var fresh=item.kind==='publication'?tongaAnalysisPublication_(item.record,model,o):tongaAnalysisCv_(ss,o,{key:item.key,value:item.value,source:item.source,evidence:item.evidence});Object.keys(fresh).forEach(function(k){item[k]=fresh[k];});delete item.error;});
 return jsonOut_({status:'ok',analysis:tongaAnalysisSave_(o,a)});
});}
