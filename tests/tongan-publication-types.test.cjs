const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const window = {};
vm.runInNewContext(fs.readFileSync('js/tongan-database-adapter.js', 'utf8'), {window, console, setTimeout});
const adapter = window.TonganMasterFileAdapter;
const master = {publications: [], authorship: [], gradDegrees: []};
for (const [type, count] of Object.entries({'Journal Article':7, 'Book Chapter':7, Book:2, 'PhD Thesis':1, 'Master’s Thesis':2, Report:12, 'Conference Paper':30, Unpublished:3, Others:1, Patent:1, 'Other Thesis':1, 'Book Review':1})) {
 for (let i=0; i<count; i++) {
  const pid = type+i;
  master.publications.push({'Publication ID / BibTeX Key':pid, 'Publication Type':type});
  master.authorship.push({'Scholar ID':'ruth', 'Publication ID / BibTeX Key':pid, 'Author Position':i%2 ? 2 : 1});
 }
}
master.authorship.push({...master.authorship[0]}); // Duplicate link must not inflate counts.
master.authorship.push({'Scholar ID':'ruth','Publication ID / BibTeX Key':'missing'});
for (const options of [undefined, {excludePreprints:true,excludeDocuments:true}]) {
 const stats = adapter.computePublicationTotals(master, 'ruth', options);
 assert.equal(stats.total, 31);
 assert.equal(stats.types.report,12);
 assert.equal(stats.firstAuthored, 17);
 assert.equal(Object.values(stats.types).reduce((a,b)=>a+b,0),stats.total);
 for(const type of ['conferencePaper','preprint','document','thesisUnknown']) assert.equal(stats.types[type],0);
}
const dashboard=fs.readFileSync('js/tongan-database-master.js','utf8');
assert(dashboard.includes('isCountedPublicationType(visualType(it))'));
assert(dashboard.includes("const CHIP_ORDER = ['journalArticle', 'bookSection', 'book', 'thesisPhd', 'thesisMasters', 'report'];"));
console.log('PASS: 31 eligible publications including 12 reports; first-authored uses same scope; badge sum equals total; excluded types and duplicate/missing links do not inflate counts.');
