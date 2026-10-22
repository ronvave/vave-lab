// Tonga review 5.1: pending-queue fixes (apostrophes, CV guards, close-without-change route).
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const c={console,JSON,Date,Math};vm.createContext(c);
for(const f of ['apps-script/deployed/tonga-submissions-v1.gs','js/tongan-attachment-parser.js','apps-script/tonga-attachment-analysis.gs','apps-script/tonga-review-v5.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
assert.strictEqual(c.tongaLiteral_("'Eua"),"''Eua",'leading apostrophe is preserved');
assert.strictEqual(c.tongaLiteral_('Tongatapu'),'Tongatapu');
assert.ok(c.tongaV5CvQuality_('position',{'Institution':'As Research Professor I lead research','Academic / Professional Title (verbatim)':'and in 2024 was the Associate'}).length>=2);
assert.ok(c.tongaV5CvQuality_('position',{'Institution':'UNIVERSITY','Academic / Professional Title (verbatim)':'Professor'}).length>=1);
assert.strictEqual(c.tongaV5CvQuality_('position',{'Institution':'Massey University','Academic / Professional Title (verbatim)':'Associate Professor'}).length,0);
const src=fs.readFileSync('apps-script/deployed/tonga-submissions-v1.gs','utf8');
assert.ok(/'closeScholarReviewItems'/.test(src.match(/var TONGA_REVIEW_ACTIONS = \[[^\]]+\]/)[0]),'close route is a review action');
assert.ok(src.includes("action === 'closeScholarReviewItems'"));
assert.ok(src.includes('setValue(tongaLiteral_(newValue))'));
assert.ok(/closeItems:true/.test(src));
const ui=fs.readFileSync('js/tongan-submissions-admin.js','utf8');
assert.ok(ui.includes('Why this is still Pending')&&ui.includes('confirmClear')&&ui.includes('thesis PDF, not needed')&&ui.includes("'Closed by reviewer'"));
console.log('tongan-review-v51 ok');
{const src2=fs.readFileSync('apps-script/deployed/tonga-submissions-v1.gs','utf8');
 assert.ok(src2.includes("action === 'finishScholarSubmission'")&&/'finishScholarSubmission'/.test(src2.match(/var TONGA_REVIEW_ACTIONS = \[[^\]]+\]/)[0]));
 const k=c.tongaKeyFiles_([{fileId:'1',field:'headshot',name:'a.jpg'},{fileId:'2',field:'cv',name:'b.pdf'},{fileId:'3',field:'publications',name:'c.bib'},{fileId:'4',field:'phd_thesis',name:'d.pdf'},{fileId:'5',field:'attachment',name:'e.ris'}]);
 assert.strictEqual(k.map(f=>f.fileId).join(','),'1,2,3,5','key files: headshot, CV, reference files only');
 const ui2=fs.readFileSync('js/tongan-submissions-admin.js','utf8');assert.ok(ui2.includes('Finish all checked')&&ui2.includes('function ask(')&&!ui2.includes('Submitted values already in Master'));
 assert.ok(src2.includes("TONGA_OWNER_NOTIFY_EMAIL='ronvave@hawaii.edu'")&&src2.includes('if (TONGA_AUTO_EMAIL_ACTIONS.indexOf(action)>=0) tongaAutoEmailKeyFiles_(body);'));
 console.log('tongan-review-v52 ok');}
