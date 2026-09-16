'use strict';

const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const files = [
  'tongan-research-database-master.html',
  'js/tongan-database-master.js'
];

for (const relative of files) {
  const text = fs.readFileSync(path.join(repo, relative), 'utf8');
  if (!text.includes('All Island Divisions')) {
    throw new Error(`${relative} is missing the protected "All Island Divisions" label`);
  }
  if (/All confederacies/i.test(text)) {
    throw new Error(`${relative} still contains the Fiji label "All Confederacies"`);
  }
}

console.log('PASS: Tongan scholar filter preserves “All Island Divisions”');
