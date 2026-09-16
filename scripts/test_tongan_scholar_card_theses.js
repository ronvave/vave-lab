'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const windowShim = {};
const ctx = vm.createContext({
  window: windowShim, console, Set, Map, Array, Object, Number, Math, String,
  Date, JSON, Error, Promise, setTimeout,
  fetch: () => Promise.reject(new Error('fetch not expected in unit test'))
});
vm.runInContext(fs.readFileSync(path.join(repo, 'js/tongan-database-adapter.js'), 'utf8'), ctx);

const adapter = windowShim.TonganMasterFileAdapter;
if (!adapter) throw new Error('Tongan adapter did not load');

const master = {
  scholars: [{ 'Scholar ID': 'TNG-S0001' }],
  publications: [{
    'Publication ID / BibTeX Key': 'pub-journal',
    'Publication Type': 'Journal Article',
    'Title': 'Existing paper'
  }],
  authorship: [{
    'Scholar ID': 'TNG-S0001',
    'Publication ID / BibTeX Key': 'pub-journal',
    'Is First Author?': true
  }],
  gradDegrees: [{
    'Degree ID': 'degree-masters-1',
    'Scholar ID': 'TNG-S0001',
    'Degree Stage': "Master's",
    'Degree / Qualification': 'Master of Education',
    'Completion Status': 'Completed',
    'Thesis / Research Title': 'A Tongan education thesis'
  }, {
    'Degree ID': 'degree-masters-untitled',
    'Scholar ID': 'TNG-S0001',
    'Degree Stage': "Master's",
    'Degree / Qualification': 'Master of Social Work',
    'Completion Status': 'Completed',
    'Thesis / Research Title': ''
  }]
};

let result = adapter.computePublicationTotals(master, 'TNG-S0001', {
  excludePreprints: true,
  excludeDocuments: true
});
if (result.total !== 3 || result.firstAuthored !== 3 || result.types.thesisMasters !== 2) {
  throw new Error('Completed Graduate Degrees Master\'s thesis was not retained on scholar card: ' + JSON.stringify(result));
}

// Rebuild the cached index after adding the matching Publications/Authorship
// row. The title punctuation differs deliberately; it must still deduplicate.
master._scholarCountIndex = null;
master.publications.push({
  'Publication ID / BibTeX Key': 'pub-masters',
  'Publication Type': 'Master’s Thesis',
  'Title': 'A Tongan education thesis!'
});
master.authorship.push({
  'Scholar ID': 'TNG-S0001',
  'Publication ID / BibTeX Key': 'pub-masters',
  'Author Position': 1
});
result = adapter.computePublicationTotals(master, 'TNG-S0001', {
  excludePreprints: true,
  excludeDocuments: true
});
if (result.total !== 3 || result.firstAuthored !== 3 || result.types.thesisMasters !== 2) {
  throw new Error('Master\'s thesis was double-counted after Publications reconciliation: ' + JSON.stringify(result));
}

console.log('PASS: scholar cards retain and deduplicate completed Master\'s theses');
