// Tonga review backend v5: CV/form → Graduate Degrees and Positions proposals, safe row append,
// formula preservation, close-previous-role proposals, geography selection. Uses a simulated Master.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
function colName(n){let s='';while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}
class Sheet{constructor(name,headers,rows,formulaCols={},prefill=0){this.name=name;this.grid=[];this.maxRows=Math.max(20,5+rows.length+prefill+5);this.ncol=headers.length;
  this.grid[4]=headers.map(h=>({v:h}));rows.forEach((r,i)=>{this.grid[5+i]=headers.map(h=>({v:r[h]==null?'':String(r[h])}));});
  const total=rows.length+prefill;for(let i=0;i<total;i++){const rn=5+i;this.grid[rn]=this.grid[rn]||headers.map(()=>({v:''}));Object.entries(formulaCols).forEach(([h,f])=>{const c=headers.indexOf(h);this.grid[rn][c]={v:'computed',f};});}}
 cell(r,c){this.grid[r]=this.grid[r]||[];return this.grid[r][c-1]=this.grid[r][c-1]||{v:''};}
 getLastRow(){let last=0;this.grid.forEach((row,i)=>{if(row&&row.some(x=>x&&(x.v!==''||x.f)))last=i;});return last;}
 getLastColumn(){return this.ncol;}getMaxRows(){return this.maxRows;}getMaxColumns(){return this.ncol;}getName(){return this.name;}
 insertRowsAfter(_,n){this.maxRows+=n;}
 getRange(r,c,nr=1,nc=1){const sh=this;const cells=()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>sh.cell(r+i,c+j)));
  return {getDisplayValues:()=>cells().map(row=>row.map(x=>x.v)),getValues:()=>cells().map(row=>row.map(x=>x.v)),getFormulas:()=>cells().map(row=>row.map(x=>x.f||'')),getFormulasR1C1:()=>cells().map(row=>row.map(x=>x.f||'')),
   getValue:()=>sh.cell(r,c).v,getDisplayValue:()=>sh.cell(r,c).v,getFormula:()=>sh.cell(r,c).f||'',setValue:v=>{sh.cell(r,c).v=String(v);delete sh.cell(r,c).f;},setFormulaR1C1:f=>{sh.cell(r,c).f=f;sh.cell(r,c).v='computed';},
   setValues:vals=>vals.forEach((row,i)=>row.forEach((v,j)=>{const x=sh.cell(r+i,c+j);x.v=String(v);delete x.f;})),setNumberFormat(){return this;},getNumRows:()=>nr,getRow:()=>r};}
 row(r){return Object.fromEntries(this.grid[4].map((h,i)=>[h.v,this.cell(r,i+1).v]));}
}
const DH=['Degree ID','Scholar ID','Scholar Name','Degree Stage','Degree / Qualification','Field / Discipline','Broad Discipline','O_Uni name','C_Uni name','Country','City','Region','International? (Outside Tonga)','Start Year','Year / Status','Finish / Completion Year','Duration (Years)','Completion Status','Thesis / Research Title','Thesis / Repository URL','Evidence URL 1','Verification','Notes','Last Checked','Created At','Created By','Updated At','Updated By','Study Date Evidence / Notes','Short Discipline'];
const PH=['Position ID','Scholar ID','Scholar Name','Institution','Country','Department / Unit','Academic / Professional Title (verbatim)','Standardized Academic Rank','Leadership Title (verbatim)','Standardized Leadership Category','Leadership Level','Role Status','Start Year','End Year','Source URL','Evidence / Notes','Last Verified','Verification Status','Created At','Created By','Updated At','Updated By'];
const SH=['Scholar ID','Scholar Name','Family Name','Given Names','Current Title / Role','Current Institution','Current Department / Unit'];
const sheets={
 'Graduate Degrees':new Sheet('Graduate Degrees',DH,[
   {'Degree ID':'TNG-D0001','Scholar ID':'TNG-S0001','Scholar Name':'Ana Tester','Degree Stage':"Master's",'O_Uni name':'University of the South Pacific','Year / Status':'2010','Completion Status':'Completed'},
   {'Degree ID':'TNG-D0002','Scholar ID':'TNG-S0002','Scholar Name':'Other','Degree Stage':'PhD/Doctorate','O_Uni name':'ANU','Year / Status':'2001'}],
   {'C_Uni name':'=IFERROR(XLOOKUP(R[0]C[-1],Lookups!A:A,Lookups!B:B),R[0]C[-1])','Finish / Completion Year':'=IF(R[0]C[-1]="","",VALUE(LEFT(R[0]C[-1],4)))'},4),
 'Positions':new Sheet('Positions',PH,[
   {'Position ID':'TNG-POS0001','Scholar ID':'TNG-S0001','Scholar Name':'Ana Tester','Institution':'Tupou Tertiary Institute','Academic / Professional Title (verbatim)':'Lecturer','Role Status':'Current','Start Year':'2012'}]),
 'Scholars':new Sheet('Scholars',SH,[{'Scholar ID':'TNG-S0001','Scholar Name':'Ana Tester','Family Name':'Tester','Given Names':'Ana','Current Title / Role':'Lecturer','Current Institution':'Tupou Tertiary Institute'}]),
 'Publications':new Sheet('Publications',['Publication ID / BibTeX Key','Entry Type','Publication Type','Title','Year','DOI'],[]),
 'Authorship':new Sheet('Authorship',['Scholar ID','Publication ID / BibTeX Key'],[]),
 'Change Log':new Sheet('Change Log',['Version','Date','Change','Scope','Source'],[])
};
// Region column is an ARRAYFORMULA in row 5 only: must never be copied into a new row.
sheets['Graduate Degrees'].cell(5,DH.indexOf('Region')+1).f='=ARRAYFORMULA(IF(J5:J="","",VLOOKUP(J5:J,Lookups!C:D,2,0)))';
const ss={getSheetByName:n=>sheets[n]||null};
const c={console,JSON,Date,Math};vm.createContext(c);
for(const f of ['js/tonga-countries.js','apps-script/deployed/tonga-submissions-v1.gs','js/tongan-attachment-parser.js','apps-script/tonga-attachment-analysis.gs','apps-script/tonga-review-v5.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
c.Utilities={formatDate:()=> '2026-10-22',getUuid:()=>crypto.randomUUID()};c.tongaNow_=()=> '2026-10-22 10:00:00';
const log=[];c.appendChangeLog_=(ss,ws,sid,field,o,n)=>log.push([ws,sid,field,n]);
const sub={'Submission ID':'SUB-1','Scholar ID':'TNG-S0001','Status':'Pending',
 'Structured Submission JSON':JSON.stringify({degrees:[{level:'phd',number:1,operation:'add',values:{university:'University of Auckland',country:'New Zealand',year:'2018',thesis_url:'https://hdl.handle.net/2292/1'}},{level:'master',number:1,operation:'update',degreeId:'TNG-D0001',values:{country:'Fiji'}}]}),
 'Submitted Fields JSON':JSON.stringify({title:'Senior Lecturer',institution:'University of the South Pacific',department:'School of Education'})};

// 1. Form proposals
let items=c.tongaV5FormItems_(ss,sub);items=items.concat(c.tongaV5CloseItems_(ss,sub,items));
const phd=items.find(i=>i.kind==='degree'&&i.record.level==='phd'),ma=items.find(i=>i.kind==='degree'&&i.record.level==='master'),pos=items.find(i=>i.kind==='position'&&!i.action),close=items.find(i=>i.action==='close');
assert.equal(phd.match,null);assert.equal(phd.state,'pending');assert.equal(phd.values['O_Uni name'],'University of Auckland');assert.equal(phd.values['Country'],'New Zealand');
assert.equal(ma.match.id,'TNG-D0001');assert.deepEqual(ma.updates.map(u=>u.field),['Country']);
assert.equal(pos.match,null);assert.equal(pos.values['Role Status'],'Current');assert.equal(pos.values['Standardized Academic Rank'],'Senior Lecturer');
assert.equal(close.match.id,'TNG-POS0001');assert.equal(close.defaultUnchecked,true);assert.equal(close.state,'needs_review');

// 2. Append a new degree row: next ID, formulas extended, ARRAYFORMULA column left blank, nothing overwritten
let res=c.tongaV5ApplyRow_(ss,sub,phd);assert.equal(res.id,'TNG-D0003');assert.equal(res.added,true);
const gd=sheets['Graduate Degrees'],row=gd.row(7);
assert.equal(row['Degree ID'],'TNG-D0003');assert.equal(row['Scholar Name'],'Ana Tester');assert.equal(row['Degree Stage'],'PhD/Doctorate');assert.equal(row['Year / Status'],'2018');
assert.equal(gd.cell(7,DH.indexOf('C_Uni name')+1).f.startsWith('=IFERROR'),true,'prefilled per-row formula kept');assert.equal(gd.cell(7,DH.indexOf('Region')+1).f,undefined,'ARRAYFORMULA never copied');
assert.equal(row['Verification'],'Verified — Admin approved scholar submission');assert.match(row['Notes'],/SUB-1/);
assert.equal(gd.row(5)['Degree ID'],'TNG-D0001');assert.equal(gd.row(6)['Degree ID'],'TNG-D0002');
// re-proposing the same degree now matches the new row (no duplicate)
const again=c.tongaV5RowItem_(ss,sub,'degree',phd.record);assert.equal(again.match.id,'TNG-D0003');assert.equal(again.state,'existing');

// 3. Fill an empty field in an existing degree row, never overwriting a filled value
res=c.tongaV5ApplyRow_(ss,sub,ma);assert.equal(res.updated,1);assert.equal(gd.row(5)['Country'],'Fiji');assert.equal(gd.row(5)['O_Uni name'],'University of the South Pacific');
const conflict=c.tongaV5RowItem_(ss,sub,'degree',{level:'master',university:'University of the South Pacific',country:'Australia',year:'2010'});assert.equal(conflict.updates.length,0);assert.equal(conflict.differences[0].field,'Country');assert.equal(gd.row(5)['Country'],'Fiji');

// 4. Positions: append new current role and close the old one
res=c.tongaV5ApplyRow_(ss,sub,pos);assert.equal(res.id,'TNG-POS0002');const pr=sheets['Positions'].row(6);assert.equal(pr['Institution'],'University of the South Pacific');assert.equal(pr['Role Status'],'Current');assert.equal(pr['Department / Unit'],'School of Education');
res=c.tongaV5ApplyRow_(ss,sub,close);assert.equal(sheets['Positions'].row(5)['Role Status'],'Past');

// 5. Master changed between review and approval → stop
const stale=c.tongaV5RowItem_(ss,sub,'degree',{level:'phd',university:'Victoria University of Wellington',year:'2024'});
sheets['Graduate Degrees'].grid[8]=DH.map(h=>({v:{'Degree ID':'TNG-D0004','Scholar ID':'TNG-S0001','Degree Stage':'PhD/Doctorate','O_Uni name':'Victoria University of Wellington'}[h]||''}));
assert.throws(()=>c.tongaV5ApplyRow_(ss,sub,stale),/Master changed/);

// 6. Validation: formula injection and invalid country refused
assert.throws(()=>c.tongaV5Validate_('position',{title:'=HYPERLINK()',institution:'X'}),/may not start/);
assert.throws(()=>c.tongaV5Validate_('position',{title:'Lecturer',institution:'X',country:'Atlantis'}),/country/);

// 7. CV pipeline end to end (no network: Crossref stubbed to "not found")
c.UrlFetchApp={fetch:()=>({getResponseCode:()=>404,getContentText:()=>'{}'})};
const cv=c.TongaAttachmentParser.cv([{page:1,text:'EDUCATION\nPhD in Pacific Studies, University of Auckland, New Zealand, 2018\nMA (Education), University of the South Pacific, Suva, Fiji, 2010\nACADEMIC APPOINTMENTS\n2021–Present Senior Lecturer, School of Education, University of the South Pacific, Fiji\n2012–2021 Lecturer, Tupou Tertiary Institute, Tonga\nPUBLICATIONS\nTester, A. (2020). Kinship and land tenure in Tonga. The Journal of Pacific History, 55(2), 123–140. https://doi.org/10.1080/00223344.2020.1234567'}]);
const a={items:[]};const cvItems=c.tongaV5CvItems_(ss,sub,cv,a);
const kinds=cvItems.reduce((m,i)=>(m[i.kind+':'+(i.match?'match':'new')+':'+i.state]=(m[i.kind+':'+(i.match?'match':'new')+':'+i.state]||0)+1,m),{});
const cvPhd=cvItems.find(i=>i.kind==='degree'&&i.record.level==='phd');assert.equal(cvPhd.match.id,'TNG-D0003','PhD added from the form is matched, not duplicated');assert.deepEqual(cvPhd.updates.map(u=>u.field).sort(),['Degree / Qualification','Field / Discipline']);
assert.ok(cvItems.some(i=>i.kind==='position'&&i.match&&i.match.id==='TNG-POS0002'),'current USP role matched');
const old=cvItems.find(i=>i.kind==='position'&&i.match&&i.match.id==='TNG-POS0001');assert.ok(old,'TTI role matched');assert.ok(old.updates.some(u=>u.field==='End Year'&&u.value==='2021'));
const pub=cvItems.find(i=>i.kind==='publication');assert.equal(pub.fromCv,true);assert.equal(pub.record.doi,'10.1080/00223344.2020.1234567');assert.equal(pub.authorPosition,1);
// Crossref enrichment only on exact match
c.UrlFetchApp={fetch:(u)=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({message:{DOI:'10.1080/00223344.2020.1234567',title:['Kinship and land tenure in Tonga'],issued:{'date-parts':[[2020]]},'container-title':['The Journal of Pacific History'],type:'journal-article',author:[{family:'Tester',given:'Ana'},{family:'Taufa',given:'L.'}]}})})};
const r={...cv.publications[0],warnings:[]};c.tongaV5Crossref_(r);assert.deepEqual(r.authors,['Tester, Ana','Taufa, L.']);assert.equal(r.publicationType,'Journal Article');assert.match(r.source,/Crossref/);
const r2={title:'Kinship and land tenure in Tonga revisited',year:'2020',authors:[],warnings:[]};c.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({message:{items:[{DOI:'10.1/x',title:['Kinship and land tenure in Tonga'],issued:{'date-parts':[[2020]]}}]}})})};c.tongaV5Crossref_(r2);assert.equal(r2.doi,undefined);assert.match(r2.warnings[0],/No exact Crossref match/);

// 8. Degree submission specs no longer target formula columns
const specs=c.scholarSubmissionFieldSpecs_().filter(s=>s.ws==='Graduate Degrees').map(s=>s.field);assert.ok(!specs.includes('C_Uni name')&&!specs.includes('Finish / Completion Year'));

// 9. Seed + approve routes (fileId 'form' needs no attachment fingerprint)
const sub2={...sub,'Submission ID':'SUB-2','Structured Submission JSON':JSON.stringify({degrees:[{level:'master',number:2,operation:'add',values:{university:'University of Hawaii at Manoa',country:'United States of America',year:'2014'}}]}),'Submitted Fields JSON':'{}'};
let store=null;c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};c.geoSs_=()=>ss;c.findScholarSubmission_=()=>sub2;c.tongaAnalysisLoad_=()=>store&&JSON.parse(JSON.stringify(store));c.tongaAnalysisSave_=(o,x)=>{x.revision=(x.revision||0)+1;store=JSON.parse(JSON.stringify(x));return x;};c.jsonOut_=o=>o;
let out=c.tongaV5SeedForm_({submissionId:'SUB-2'});assert.equal(out.added,1);assert.equal(store.items[0].fileId,'form');
assert.equal(c.tongaV5SeedForm_({submissionId:'SUB-2'}).alreadySeeded,true,'seeding is idempotent');
out=c.tongaApproveAnalysis_({submissionId:'SUB-2',revision:store.revision,itemIds:[store.items[0].id],decision:'approve'});
assert.equal(store.items[0].state,'applied');assert.match(store.items[0].result.id,/^TNG-D\d{4}$/);
assert.ok(log.some(l=>l[0]==='Graduate Degrees'&&/Row added/.test(l[2])),'change log entry written');
assert(c.TONGA_REVIEW_ACTIONS.includes('seedFormProposals')&&c.TONGA_REVIEW_ACTIONS.includes('crossrefAttachmentProposal'));
// 10. Edit a proposal into a forced separate row
const sub3={...sub,'Submission ID':'SUB-3','Structured Submission JSON':JSON.stringify({degrees:[{level:'master',number:1,operation:'add',values:{university:'University of the South Pacific',year:'2010'}}]}),'Submitted Fields JSON':'{}'};
store=null;c.findScholarSubmission_=()=>sub3;c.tongaV5SeedForm_({submissionId:'SUB-3'});assert.equal(store.items[0].match.id,'TNG-D0001');
c.tongaEditAnalysis_({submissionId:'SUB-3',revision:store.revision,kind:'degree',itemId:store.items[0].id,record:{degreeName:'MA Education'},newRow:true});
assert.equal(store.items[0].match,null);assert.equal(store.items[0].record.forceNew,true);assert.equal(store.items[0].values['Degree / Qualification'],'MA Education');
console.log('PASS v5: form degree/position proposals, safe append with formula extension, fill-empty-only updates, close previous role, stale-master stop, validation, CV pipeline, Crossref exact-match only, degree specs, seed/approve/edit routes');
