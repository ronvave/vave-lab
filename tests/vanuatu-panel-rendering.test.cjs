const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('vanuatu-research-database-master.html', 'utf8');
assert(!/\d+ tokens truncated|\d+ chars truncated/.test(html), 'Published HTML must never contain truncated tool output');
for (const selector of ['.db-b2-mode button', '.db-world-grid', '.db-world-search svg', '.db-submit-modal .grid']) {
  assert(html.includes(selector + ' {'), 'Missing reference styles: ' + selector);
}
const w={};const c=vm.createContext({window:w});
for(const f of ['geography','model','dashboard-model','preview-data','bundle-bridge']) vm.runInContext(fs.readFileSync('js/vanuatu-'+f+'.js','utf8'),c);
w.VanuatuBundle.preview();
w.VanuatuBundle.current().tables['Study Pathways']=[];
w.VanuatuBundle.fetchJson('data/vanuatu-master-mobility.json').then(rows=>{
  assert.equal(rows.length,1,'B3 bridge must use the existing unambiguous degree pathway calculation');
  assert.equal(rows[0].scholar_id,'VAN-S9001');
  console.log('PASS: full restored panel stylesheet and live B3 bridge');
}).catch(e=>{console.error(e);process.exitCode=1;});
