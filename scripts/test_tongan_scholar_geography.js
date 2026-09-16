'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'js/tongan-database-master.js'), 'utf8');
const start = source.indexOf('const _MAINLAND_ISLANDS_SUPPRESS');
const end = source.indexOf('  // Expose the formatter for tests', start);
if (start < 0 || end < 0) throw new Error('Could not locate shared geography formatter');

const ctx = vm.createContext({});
vm.runInContext(source.slice(start, end) + '\nthis.formatScholarGeography = formatScholarGeography;', ctx);
const format = ctx.formatScholarGeography;

const cases = [
  ["Te'ekiu", 'Tongatapu (main island)', 'Kolovai', "Te'ekiu vlg (Tongatapu Is), Kolovai District."],
  ["Te'ekiu", 'Tongatapu (main island) Is', 'Kolovai Province', "Te'ekiu vlg (Tongatapu Is), Kolovai District."],
  ["Te'ekiu", 'Tongatapu Island Division', 'Kolovai District', "Te'ekiu vlg (Tongatapu Is), Kolovai District."],
  ['Neiafu', "Vava'u Island", "Vava'u", "Neiafu vlg (Vava'u Is), Vava'u District."],
  ['', 'Tongatapu (main island)', 'Kolovai', 'Tongatapu Is, Kolovai District.'],
  ['', '', 'Kolovai', 'Kolovai District.']
];

for (const [village, island, province, expected] of cases) {
  const actual = format(village, island, province);
  if (actual !== expected) {
    throw new Error(`Geography mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('PASS: Tongan scholar locality labels use concise island names');
