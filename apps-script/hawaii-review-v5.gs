/** Hawaiʻi review backend v5 additions.
 * - Graduate Degrees and Positions proposals (update an existing row or append a new row)
 *   from the CV and from the structured degrees / current-position fields of the submission form.
 * - Publications listed inside a CV, optionally completed from Crossref (public metadata only).
 * - Optional server-side OCR of scanned CV PDFs (requires the Drive advanced service).
 * Nothing is written to Master until a reviewer approves a selected proposal.
 */
var HAWAII_V5_DEGREE_FIELDS = ['Degree Stage','Degree / Qualification','Field / Discipline','O_Uni name','Country','City','Year / Status','Completion Status','Thesis / Research Title','Thesis / Repository URL','Start Year'];
var HAWAII_V5_POSITION_FIELDS = ['Institution','Country','Department / Unit','Academic / Professional Title (verbatim)','Standardized Academic Rank','Leadership Title (verbatim)','Role Status','Start Year','End Year','Source URL'];
var HAWAII_V5_RANKS = ['','Lecturer','Senior Lecturer','Associate Professor','Professor','Assistant Professor','Research Fellow','Research Associate','Research Affiliate','Research Professor','Assistant Clinical Professor','Adjunct Faculty','Faculty','Teacher','Director'];
var HAWAII_V5_PROVENANCE = 'Verified — Admin approved scholar submission';

function hawaiiV5Today_(){return Utilities.formatDate(new Date(),TIMEZONE,'yyyy-MM-dd');}
function hawaiiV5Norm_(s){return HawaiiAttachmentParser.norm(s);}
function hawaiiV5Same_(a,b){a=hawaiiV5Norm_(a);b=hawaiiV5Norm_(b);return !!a&&!!b&&(a===b||(a.length>6&&b.length>6&&(a.indexOf(b)>=0||b.indexOf(a)>=0)));}
function hawaiiV5Country_(v){v=String(v||'').trim();if(!v)return '';var c=HawaiiCountries.resolve(v);return c?c.name:'';}
function hawaiiV5Year_(v){v=String(v||'').trim();return /^(19|20)\d{2}$/.test(v)?v:'';}
function hawaiiV5ScholarName_(ss,sid){var s=hawaiiAnalysisObjects_(ss,'Scholars').filter(function(x){return x['Scholar ID']===sid;})[0];return s?(s['Scholar Name']||[s['Given Names'],s['Family Name']].filter(Boolean).join(' ')):'';}
function hawaiiV5Rows_(ss,name,sid){return hawaiiAnalysisObjects_(ss,name).filter(function(x){return x['Scholar ID']===sid;});}

/** Column values a degree record would write. Blank values are never written. */
function hawaiiV5DegreeValues_(rec){
  var v={};
  v['Degree Stage']=rec.level==='phd'?'PhD/Doctorate':"Master's";
  v['Degree / Qualification']=String(rec.degreeName||'').trim();
  v['Field / Discipline']=String(rec.field||'').trim();
  v['O_Uni name']=String(rec.university||'').trim();
  v['Country']=hawaiiV5Country_(rec.country);
  v['City']=String(rec.city||'').trim();
  v['Completion Status']=rec.completion==='In progress'?'In progress':'Completed';
  v['Year / Status']=v['Completion Status']==='Completed'?hawaiiV5Year_(rec.year):'';
  v['Thesis / Research Title']=String(rec.thesisTitle||'').trim();
  v['Thesis / Repository URL']=/^https?:\/\/\S+$/i.test(String(rec.thesisUrl||'').trim())?String(rec.thesisUrl).trim():'';
  v['Start Year']=hawaiiV5Year_(rec.startYear);
  return v;
}
function hawaiiV5PositionValues_(rec){
  var v={};
  v['Institution']=String(rec.institution||'').trim();
  v['Country']=hawaiiV5Country_(rec.country);
  v['Department / Unit']=String(rec.department||'').trim();
  v['Academic / Professional Title (verbatim)']=String(rec.title||'').trim();
  v['Standardized Academic Rank']=HAWAII_V5_RANKS.indexOf(rec.rank||'')>=0?(rec.rank||''):'';
  v['Leadership Title (verbatim)']=String(rec.leadershipTitle||'').trim();
  v['Role Status']=rec.current?'Current':'Past';
  v['Start Year']=hawaiiV5Year_(rec.startYear);
  v['End Year']=rec.current?'':hawaiiV5Year_(rec.endYear);
  v['Source URL']=/^https?:\/\/\S+$/i.test(String(rec.sourceUrl||'').trim())?String(rec.sourceUrl).trim():'';
  return v;
}
function hawaiiV5Validate_(kind,rec){
  var long=Object.keys(rec).some(function(k){return typeof rec[k]==='string'&&rec[k].length>1500;});if(long)throw Error('Value too long');
  Object.keys(rec).forEach(function(k){if(typeof rec[k]==='string'&&/^[=+@]/.test(rec[k].trim()))throw Error('Values may not start with = + or @');});
  if(kind==='degree'){if(['phd','master'].indexOf(rec.level)<0)throw Error('Choose Masters or PhD');if(!String(rec.university||'').trim())throw Error('University required');}
  else{if(!String(rec.institution||'').trim()||!String(rec.title||'').trim())throw Error('Institution and title required');if(rec.country&&!hawaiiV5Country_(rec.country))throw Error('Choose a country from the list');}
}

/** Signs that CV text was split badly. Returns a list of plain-language problems. */
function hawaiiV5CvQuality_(kind,values){
  var out=[],fields=kind==='degree'?['O_Uni name','Degree / Qualification']:['Institution','Academic / Professional Title (verbatim)','Department / Unit'];
  fields.forEach(function(f){var v=String(values[f]||'').trim();if(!v)return;
    if(v.length>(f==='Institution'||f==='O_Uni name'?100:160))out.push(f+' is unusually long');
    else if(/^[a-z]/.test(v))out.push(f+' starts mid-sentence');
    else if(/(^|\s)(I|my|we|our)(\s|$)/.test(v))out.push(f+' reads like a sentence');
    else if(v.length>3&&v===v.toUpperCase()&&/[A-Z]{4}/.test(v))out.push(f+' is in capitals');
    if(/^(university|college|institute|school|department)$/i.test(v))out.push(f+' is only a generic word');});
  return out;
}
/** Build a degree or position proposal against the live Master. */
function hawaiiV5RowItem_(ss,o,kind,rec,extra){
  var sheet=kind==='degree'?'Graduate Degrees':'Positions',idField=kind==='degree'?'Degree ID':'Position ID';
  var rows=hawaiiV5Rows_(ss,sheet,o['Scholar ID']),values=kind==='degree'?hawaiiV5DegreeValues_(rec):hawaiiV5PositionValues_(rec),match=null,reason='';
  if(rec.forceNew){reason='';}
  else if(rec.targetId){match=rows.filter(function(r){return r[idField]===rec.targetId;})[0]||null;if(!match)reason=rec.targetId+' is no longer in Master for this scholar.';}
  else if(kind==='degree'){
    var same=rows.filter(function(r){return r['Degree Stage']===values['Degree Stage']&&((values['O_Uni name']&&(hawaiiV5Same_(r['O_Uni name'],values['O_Uni name'])||hawaiiV5Same_(r['C_Uni name'],values['O_Uni name'])))||(values['Year / Status']&&String(r['Year / Status']).slice(0,4)===values['Year / Status']));});
    if(same.length===1)match=same[0];else if(same.length>1)reason='Several existing '+values['Degree Stage']+' rows look similar; choose the row to update or add a new row.';
  }else{
    var hits=rows.filter(function(r){return hawaiiV5Same_(r['Institution'],values['Institution'])&&(hawaiiV5Same_(r['Academic / Professional Title (verbatim)'],values['Academic / Professional Title (verbatim)'])||(values['Start Year']&&r['Start Year']===values['Start Year']));});
    if(hits.length===1)match=hits[0];else if(hits.length>1)reason='Several existing Positions rows look similar; choose the row to update or add a new row.';
  }
  var updates=[],differences=[];
  if(match){
    Object.keys(values).forEach(function(f){var nv=values[f],cv=String(match[f]==null?'':match[f]).trim();if(!nv||normalizeForCompare_(cv)===normalizeForCompare_(nv))return;
      if(f==='Degree Stage')return;
      if(!cv)updates.push({field:f,current:'',value:nv});
      else if(kind==='position'&&f==='Role Status'&&/^current/i.test(cv)&&nv==='Past')updates.push({field:f,current:cv,value:nv});
      else differences.push({field:f,current:cv,value:nv});});
  }
  var label=kind==='degree'?(values['Degree Stage']+(values['Degree / Qualification']?' · '+values['Degree / Qualification']:'')+(values['O_Uni name']?' · '+values['O_Uni name']:'')):
    (values['Academic / Professional Title (verbatim)']+' · '+values['Institution']);
  var state=reason?'needs_review':match?(updates.length?'pending':'existing'):'pending';
  if(!reason&&match&&!updates.length)reason=differences.length?'Matches '+match[idField]+'; Master already has different values (listed below). Edit Master directly if the submission is right.':'Already recorded as '+match[idField]+'.';
  if(!reason&&match)reason='Fills empty Master fields in '+match[idField]+(differences.length?'; other differing values are listed but not changed.':'.');
  if(!reason)reason=(rec.forceNew?'New row (reviewer chose to add a separate row). ':'New '+sheet+' row. ')+'Check every value against the source before approving.';
  var item={kind:kind,record:rec,label:label,values:values,match:match?{id:match[idField],row:match._row}:null,updates:updates,differences:differences,state:state,reason:reason,source:rec.source||'',evidence:rec.evidence||''};
  // CV text is parsed heuristically. Every CV-derived row starts unticked, and rows whose
  // text looks like a sentence, a fragment or SHOUTED capitals are flagged for checking.
  if(/^CV page/i.test(rec.source||'')){item.defaultUnchecked=true;var q=hawaiiV5CvQuality_(kind,values);if(q.length&&item.state==='pending'){item.state='needs_review';item.reason='CV text needs checking before approval: '+q.join('; ')+'. Edit the proposal or decline it.';}}
  if(extra)Object.keys(extra).forEach(function(k){item[k]=extra[k];});
  return item;
}
/** When a new current appointment is proposed, offer (unticked) to mark other current rows as past. */
function hawaiiV5CloseItems_(ss,o,items){
  var rows=hawaiiV5Rows_(ss,'Positions',o['Scholar ID']).filter(function(r){return /^current/i.test(String(r['Role Status']||''));}),out=[];
  var current=items.filter(function(i){return i.kind==='position'&&i.record.current&&!i.match&&i.state==='pending';});if(!current.length)return out;
  var start=current.map(function(i){return i.values['Start Year'];}).filter(Boolean).sort()[0]||'';
  rows.forEach(function(r){var listed=items.some(function(i){return i.kind==='position'&&i.match&&i.match.id===r['Position ID'];});if(listed)return;
    out.push({kind:'position',action:'close',record:{targetId:r['Position ID'],endYear:start,source:current[0].source},label:'Mark '+r['Position ID']+' as past: '+r['Academic / Professional Title (verbatim)']+' · '+r['Institution'],match:{id:r['Position ID'],row:r._row},
      updates:[{field:'Role Status',current:r['Role Status'],value:'Past'}].concat(start&&!r['End Year']?[{field:'End Year',current:'',value:start}]:[]),differences:[],state:'needs_review',defaultUnchecked:true,
      reason:'Master lists this as a current role, but the submission names a new current appointment. Approve only if this role has ended.',source:current[0].source,evidence:current[0].evidence});});
  return out;
}

/** Next sequential ID with the same prefix and zero padding as existing IDs (e.g. HAW-D0391 → HAW-D0392). */
function hawaiiV5NextId_(t,idField,prefix){
  var i=t.headers.indexOf(idField),max=0,width=4;
  t.rows.forEach(function(r){var m=new RegExp('^'+prefix+'(\\d+)$').exec(String(r[i]||''));if(m){max=Math.max(max,Number(m[1]));width=Math.max(width,m[1].length);}});
  var n=String(max+1);while(n.length<width)n='0'+n;return prefix+n;
}
/** Append one literal row. Columns that already hold formulas in the target row are left untouched;
 * per-row formulas in the row above are extended into the new row; ARRAYFORMULA columns are skipped. */
function hawaiiV5AppendRow_(ss,sheetName,idField,prefix,values){
  HAWAII_READ_TABLES=null;var t=hawaiiTable_(ss,sheetName),sh=t.sheet,idCol=t.headers.indexOf(idField);
  Object.keys(values).forEach(function(h){if(t.headers.indexOf(h)<0)throw Error(sheetName+' header missing: '+h);});
  if(idCol<0)throw Error(sheetName+' header missing: '+idField);
  var last=-1;t.rows.forEach(function(r,i){if(String(r[idCol]||'').trim())last=i;});
  var row=5+last+1,id=hawaiiV5NextId_(t,idField,prefix),n=t.headers.length;
  if(row>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),1);
  var target=sh.getRange(row,1,1,n),formulas=target.getFormulas()[0],display=target.getDisplayValues()[0];
  for(var c=0;c<n;c++)if(!formulas[c]&&String(display[c]||'').trim())throw Error(sheetName+' row '+row+' is not empty; append stopped so nothing is overwritten');
  var tmplRow=Math.max(5,row-1),tmpl=sh.getRange(Math.max(5,row-30),1,tmplRow-Math.max(5,row-30)+1,n).getFormulasR1C1();
  values[idField]=id;
  for(c=0;c<n;c++){
    var h=t.headers[c];if(!h||formulas[c])continue;
    var cell=sh.getRange(row,c+1);
    if(values[h]!==undefined&&values[h]!==''){cell.setValue(hawaiiLiteral_(values[h]));continue;}
    for(var k=tmpl.length-1;k>=0;k--){var f=tmpl[k][c];if(f){if(!/ARRAYFORMULA/i.test(f))cell.setFormulaR1C1(f);break;}}
  }
  return {id:id,row:row};
}
function hawaiiV5ApplyRow_(ss,o,item){
  var kind=item.kind,sheet=kind==='degree'?'Graduate Degrees':'Positions',idField=kind==='degree'?'Degree ID':'Position ID';
  var fresh=item.action==='close'?null:hawaiiV5RowItem_(ss,o,kind,item.record);
  if(fresh&&(fresh.match?fresh.match.id:'')!==(item.match?item.match.id:''))throw Error('Master changed; refresh proposals before approving');
  var stamp=hawaiiNow_(),prov='Submission '+o['Submission ID']+' ('+(item.source||'form')+')';
  if(item.match){
    var rows=hawaiiV5Rows_(ss,sheet,o['Scholar ID']),r=rows.filter(function(x){return x[idField]===item.match.id;})[0];if(!r)throw Error(item.match.id+' no longer in Master');
    var updates=item.action==='close'?item.updates:fresh.updates;if(!updates.length)return {id:item.match.id,updated:0};
    updates.forEach(function(u){var res=applyOneChange_(ss,{worksheet:sheet,scholarId:o['Scholar ID'],rowNumber:r._row,field:u.field,oldValue:u.current,newValue:u.value},false);
      if(['ok','already_satisfied'].indexOf(res.status)<0)throw Error('Write validation failed for '+u.field+': '+res.status);});
    var t=hawaiiTable_(ss,sheet);['Updated At','Updated By'].forEach(function(h,i){var c=t.headers.indexOf(h);if(c>=0)t.sheet.getRange(r._row,c+1).setValue(i?ACTOR_LABEL:stamp);});
    return {id:item.match.id,updated:updates.length};
  }
  var values={};Object.keys(item.values).forEach(function(k){values[k]=item.values[k];});
  hawaiiV5Validate_(kind,item.record);values=kind==='degree'?hawaiiV5DegreeValues_(item.record):hawaiiV5PositionValues_(item.record);
  var cfg=MAPPING.worksheets[sheet].fields;Object.keys(values).forEach(function(k){if(!cfg[k]||values[k]==='')return;var chk=validateValue_(values[k],cfg[k]);if(!chk.ok)throw Error(k+': '+chk.reason);values[k]=chk.coerced;});
  values['Scholar ID']=o['Scholar ID'];values['Scholar Name']=hawaiiV5ScholarName_(ss,o['Scholar ID']);
  values['Created At']=stamp;values['Created By']=ACTOR_LABEL;values['Updated At']=stamp;values['Updated By']=ACTOR_LABEL;
  var evidence=String(item.evidence||'').replace(/\s+/g,' ').slice(0,400);
  if(kind==='degree'){values['Verification']=HAWAII_V5_PROVENANCE;values['Notes']=prov;values['Last Checked']=hawaiiV5Today_();if(evidence)values['Study Date Evidence / Notes']=evidence;}
  else{values['Verification Status']=HAWAII_V5_PROVENANCE;values['Evidence / Notes']=prov+(evidence?': '+evidence:'');values['Last Verified']=hawaiiV5Today_();}
  var added=hawaiiV5AppendRow_(ss,sheet,idField,kind==='degree'?'HAW-D':'HAW-POS',values);
  appendChangeLog_(ss,sheet,o['Scholar ID'],'Row added: '+added.id,'',item.label+' — '+prov);
  return {id:added.id,added:true};
}

/** Marks proposals that repeat an earlier open proposal (e.g. the same degree typed in the form and listed in the CV). */
function hawaiiV5RowKey_(i){if(i.action==='close')return 'close|'+i.match.id;if(i.kind==='degree')return 'd|'+i.values['Degree Stage']+'|'+(i.match?i.match.id:hawaiiV5Norm_(i.values['O_Uni name']));return 'p|'+(i.match?i.match.id:hawaiiV5Norm_(i.values['Institution'])+'|'+hawaiiV5Norm_(i.values['Academic / Professional Title (verbatim)']));}
function hawaiiV5Dedupe_(earlier,items){var seen={};earlier.forEach(function(i){if((i.kind==='degree'||i.kind==='position')&&['pending','needs_review','applied'].indexOf(i.state)>=0)seen[hawaiiV5RowKey_(i)]=i;});
  items.forEach(function(i){if(i.kind!=='degree'&&i.kind!=='position')return;var k=hawaiiV5RowKey_(i);if(seen[k]&&i.state!=='existing'){i.state='duplicate';i.reason='Same '+(i.kind==='degree'?'degree':'position')+' as another proposal ('+(seen[k].source||seen[k].fileName||'')+'); review that one.';}else seen[k]=i;});return items;}
/** Proposals from the submission form itself (structured degrees and a changed current title/institution). */
function hawaiiV5FormItems_(ss,o){
  var items=[],s=parseJsonObject_(o['Structured Submission JSON'])||{},f=parseJsonObject_(o['Submitted Fields JSON'])||{};
  (Array.isArray(s.degrees)?s.degrees:[]).forEach(function(g){var v=g.values||{};
    var rec={level:g.level==='phd'?'phd':'master',degreeName:'',field:'',university:v.university||'',country:v.country||'',year:v.year||'',thesisUrl:v.thesis_url||'',completion:'Completed',targetId:g.operation==='update'?(g.degreeId||''):'',source:'Submission form ('+(g.level==='phd'?'PhD':'Masters')+' #'+g.number+')',evidence:''};
    if(!rec.university&&!rec.targetId)return;
    if(rec.targetId){var existing=hawaiiV5Rows_(ss,'Graduate Degrees',o['Scholar ID']).filter(function(r){return r['Degree ID']===rec.targetId;})[0];if(existing&&!rec.university)rec.university=existing['O_Uni name']||existing['C_Uni name'];}
    items.push(hawaiiV5RowItem_(ss,o,'degree',rec));});
  if(f.title||f.institution){
    var sch=hawaiiAnalysisObjects_(ss,'Scholars').filter(function(x){return x['Scholar ID']===o['Scholar ID'];})[0]||{};
    var rec={title:f.title||sch['Current Title / Role']||'',institution:f.institution||sch['Current Institution']||'',department:f.department||sch['Current Department / Unit']||'',country:'',current:true,startYear:'',rank:HawaiiAttachmentParser.cvRank(f.title||sch['Current Title / Role']||''),leadershipTitle:'',source:'Submission form (current position)',evidence:''};
    if(rec.title&&rec.institution)items.push(hawaiiV5RowItem_(ss,o,'position',rec));
  }
  return items;
}
function hawaiiV5SeedForm_(body){return hawaiiWithSubmission_(body,function(ss,o){
  var a=hawaiiAnalysisLoad_(o)||{version:1,submissionId:o['Submission ID'],scholarId:o['Scholar ID'],files:[],items:[],revision:0};
  if(a.formSeeded)return jsonOut_({status:'ok',analysis:a,alreadySeeded:true});
  if(body.revision!==undefined&&a.revision&&a.revision!==body.revision)throw Error('Analysis changed; reload first');
  var items=hawaiiV5FormItems_(ss,o);items=items.concat(hawaiiV5CloseItems_(ss,o,items));hawaiiV5Dedupe_(a.items,items);
  items.forEach(function(it,i){it.id='form:'+(i+1);it.fileId='form';it.fileName='Submission form';a.items.push(it);});
  a.formSeeded=true;return jsonOut_({status:'ok',analysis:hawaiiAnalysisSave_(o,a),added:items.length});
});}

/** CV items: degrees, positions and publication list. Called from hawaiiAnalyseAttachment_. */
function hawaiiV5CvItems_(ss,o,result,a){
  var items=[];
  (result.degrees||[]).forEach(function(g){items.push(hawaiiV5RowItem_(ss,o,'degree',g));});
  (result.positions||[]).forEach(function(p){items.push(hawaiiV5RowItem_(ss,o,'position',p));});
  items=items.concat(hawaiiV5CloseItems_(ss,o,items));hawaiiV5Dedupe_(a.items,items);
  var model=hawaiiAnalysisModel_(ss,o),started=Date.now(),looked=0;
  (result.publications||[]).forEach(function(r){
    if(Date.now()-started<150000&&looked<40){looked++;try{hawaiiV5Crossref_(r);}catch(e){r.warnings.push('Crossref look-up failed: '+String(e.message||e).slice(0,120));}}
    else r.warnings.push('Not looked up in Crossref (time limit). Use "Look up in Crossref" on this proposal.');
    var key=HawaiiAttachmentParser.doi(r.doi)||HawaiiAttachmentParser.norm(r.title)+'|'+r.year;
    var item=hawaiiAnalysisPublication_(r,model,o);item.fromCv=true;
    var earlier=a.items.concat(items).find(function(x){return x.kind==='publication'&&(HawaiiAttachmentParser.doi(x.record.doi)||HawaiiAttachmentParser.norm(x.record.title)+'|'+x.record.year)===key;});
    if(earlier){item.state='duplicate';item.reason='Also in another uploaded file; import only once.';}
    items.push(item);
  });
  return items;
}
/** Completes a CV reference from Crossref. Only accepts a match with the same DOI, or the same title and year. */
function hawaiiV5Crossref_(r){
  var p=HawaiiAttachmentParser,url,res,msg;
  if(r.doi){res=UrlFetchApp.fetch('https://api.crossref.org/works/'+encodeURIComponent(r.doi),{muteHttpExceptions:true,headers:{'User-Agent':'VaveLab-HawaiiAdmin/5 (https://ronvave.github.io/vave-lab/)'}});if(res.getResponseCode()!==200){r.warnings.push('DOI not found in Crossref');return r;}msg=JSON.parse(res.getContentText()).message;}
  else{
    if(!r.title||r.title.length<12)return r;
    url='https://api.crossref.org/works?rows=3&select=DOI,title,author,issued,container-title,publisher,type,URL&query.bibliographic='+encodeURIComponent(r.title+' '+(r.year||''));
    res=UrlFetchApp.fetch(url,{muteHttpExceptions:true,headers:{'User-Agent':'VaveLab-HawaiiAdmin/5 (https://ronvave.github.io/vave-lab/)'}});if(res.getResponseCode()!==200)return r;
    var hits=(JSON.parse(res.getContentText()).message.items||[]).filter(function(x){var y=x.issued&&x.issued['date-parts']&&x.issued['date-parts'][0]&&String(x.issued['date-parts'][0][0]);return p.norm((x.title||[''])[0])===p.norm(r.title)&&(!r.year||y===r.year);});
    if(hits.length!==1){r.warnings.push('No exact Crossref match; values come from the CV text only.');return r;}msg=hits[0];
  }
  var types={'journal-article':'Journal Article','book':'Book','monograph':'Book','edited-book':'Book','book-chapter':'Book Chapter','proceedings-article':'Conference Paper','report':'Report','dissertation':'Other Thesis'};
  var y=msg.issued&&msg.issued['date-parts']&&msg.issued['date-parts'][0]&&String(msg.issued['date-parts'][0][0]);
  if(r.doi&&p.norm((msg.title||[''])[0])!==p.norm(r.title)&&r.title)r.warnings.push('Crossref title differs from the CV: '+String((msg.title||[''])[0]).slice(0,200));
  r.crossref={doi:p.doi(msg.DOI),title:(msg.title||[''])[0]||'',year:y||''};
  r.doi=p.doi(msg.DOI)||r.doi;r.title=(msg.title||[''])[0]||r.title;r.year=y||r.year;
  if(msg['container-title']&&msg['container-title'][0])r.venue=msg['container-title'][0];if(msg.publisher)r.publisher=msg.publisher;if(types[msg.type])r.publicationType=types[msg.type];
  if(Array.isArray(msg.author)&&msg.author.length)r.authors=msg.author.map(function(x){return x.family?(x.family+(x.given?', '+x.given:'')):(x.name||'');}).filter(Boolean).slice(0,100);
  if(!r.url&&r.doi)r.url='https://doi.org/'+r.doi;
  r.source=r.source+' + Crossref';return r;
}
function hawaiiV5CrossrefItem_(body){return hawaiiWithSubmission_(body,function(ss,o){
  var a=hawaiiAnalysisLoad_(o);if(!a||a.revision!==body.revision)throw Error('Analysis changed; reload first');
  var item=a.items.find(function(x){return x.id===body.itemId;});if(!item||item.kind!=='publication')throw Error('Publication proposal not found');
  if(['pending','needs_review'].indexOf(item.state)<0)throw Error('This item already has a final outcome');
  var r=JSON.parse(JSON.stringify(item.record));r.warnings=[];hawaiiV5Crossref_(r);var fresh=hawaiiAnalysisPublication_(r,hawaiiAnalysisModel_(ss,o),o);fresh.fromCv=item.fromCv;
  Object.keys(fresh).forEach(function(k){item[k]=fresh[k];});return jsonOut_({status:'ok',analysis:hawaiiAnalysisSave_(o,a)});
});}

/** Server text extraction with OCR, used for scanned CV PDFs. Needs Services → Drive API (v3) in the Apps Script editor. */
function hawaiiV5OcrPages_(fileId){
  if(typeof Drive==='undefined'||!Drive.Files)throw Error('Server OCR needs the Drive API service. In the Apps Script editor: Services → Drive API → Add, then deploy a new version.');
  var folder=PropertiesService.getScriptProperties().getProperty('SCHOLAR_SUBMISSION_FOLDER_ID');
  var blob=DriveApp.getFileById(fileId).getBlob(),doc=Drive.Files.create({name:'OCR-temp-'+fileId,mimeType:'application/vnd.google-apps.document',parents:folder?[folder]:undefined},blob,{ocrLanguage:'en'});
  try{var text=DocumentApp.openById(doc.id).getBody().getText();}finally{try{DriveApp.getFileById(doc.id).setTrashed(true);}catch(_){}}
  text=String(text||'').replace(/\r/g,'');if(text.trim().length<30)throw Error('OCR found no readable text in this file');
  var pages=[],chunk='',n=1;text.split('\n').forEach(function(l){if(chunk.length+l.length>3500){pages.push({page:n++,text:chunk});chunk='';}chunk+=(chunk?'\n':'')+l;});if(chunk)pages.push({page:n,text:chunk});
  return pages.slice(0,100);
}

/** Editor-only helper: run once after pasting v5 so Google asks for any new permission
 * (Crossref look-ups use UrlFetchApp). Returns no private values. */
function hawaiiV5CheckSetup(){
  var r=UrlFetchApp.fetch('https://api.crossref.org/works?rows=0',{muteHttpExceptions:true});
  var ocr=typeof Drive!=='undefined'&&!!Drive.Files;
  var out={version:HAWAII_SUBMISSIONS_VERSION,crossrefReachable:r.getResponseCode()===200,serverOcrAvailable:ocr,parserLoaded:typeof HawaiiAttachmentParser!=='undefined'&&typeof HawaiiAttachmentParser.cvStructured==='function'};
  Logger.log(JSON.stringify(out));return out;
}
